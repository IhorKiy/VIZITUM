# Design note: putting a DTO in front of `imports`

Status: decision note, written before the code in the same change · Date: 2026-08-04 · Scope: `ImportsController`'s one `@Body()` route

Item 2.4 of [security-remediation-plan.md](../security-remediation-plan.md) asks
for this note before the code, for the same reason it asked for
[the `visits` one](visits-dto-migration-note.md): `csvText` is "a large,
intentionally loose body (bounded only by the JSON body limit)", and the tier is
"worth its own short design note on what 'whitelisted' even means for a body
that is mostly a text blob — the same question `visits`'s `confirmedData`
raises."

It is the same question and it does **not** have the same answer for the same
reasons, which is the point of writing this down rather than citing the earlier
note. The conclusion happens to rhyme — gate the envelope, leave the blob
opaque — but the argument that settled `visits` does not apply here at all, and
the honest statement of what the gate does not buy is longer than the statement
of what it does.

## The surface

`ImportsController` has five routes and exactly one takes a `@Body()`:

| Route | Body | Parsed where |
| ----- | ---- | ------------ |
| `POST /imports/jobs/validate` | `templateType, csvText, fileName?` | **the controller** (`parseImportTemplateType`, `parseCsvText`, `parseFileName`) |
| `GET /imports/templates`, `GET /imports/templates/:templateFile`, `GET /imports/jobs`, `GET /imports/jobs/:importJobId` | — | — |
| `POST /imports/jobs/:importJobId/confirm` | — (path param only) | — |

Two things follow. This is the smallest tier on the track by route count — one
route, three fields — and, as with the AI routes in tier 3, the body is parsed
**in the controller** rather than in a service, so a DTO sits directly in front
of three `parse*` helpers in the same file. Those helpers stay, unchanged,
exactly as every other tier left its normalizers in place. `POST
/jobs/:importJobId/confirm` is a body-less POST and must **not** get the pipe —
the same case as `archive`/`unarchive` in tier 4.

## Q1. What "whitelisted" means for `csvText`

**Decision: `@IsString()` and nothing else. No cap, no shape, no content
inspection.**

The plan asks this to be decided on its own merits rather than inherited from
`confirmedData`, and it flags the reason: `csvText` is not replayed from a
device outbox, so the argument that decided `visits` — that a whitelist
refusing a property an older client produced destroys a rep's finished work —
has no counterpart here. An import is composed in one sitting, in an admin's
browser, against a template the API itself served moments earlier. If this
endpoint refuses a body, nobody's completed work is lost; they pick the file
again.

So the case has to be made from scratch, and it is much simpler than the
`visits` one:

**`confirmedData` is an object; `csvText` is a scalar.** A whitelist walks
properties. `confirmedData` *has* properties — the question there was whether
declaring them was possible (two unrelated shapes, one of them per-tenant) and
whether it was safe (replay). `csvText` has none. There is no version of this
DTO that reaches inside a string. The choice is not "shallow or deep" but
"declare the field or don't", and not declaring it would strip the entire
payload.

That makes Q1 nearly trivial, and the interesting question the one below.

## Q2. What the gate does **not** buy — the part worth writing down

An import is the widest write path in the product: one request creates or
updates users, locations, contacts, products or a whole visit/task plan. It
would be easy to read "`POST /imports/jobs/validate` is now gated by a
class-validator DTO" as though the import path had been validated. It has not.
Everything that actually defends this endpoint lives behind the pipe and is
untouched by this change:

- **The header allowlist.** `parseApprovedCsvTemplate` → `assertApprovedHeader`
  refuses any column the template does not declare. *This* is the import path's
  anti-mass-assignment control, and it is the real analogue of what the DTO does
  for a JSON body — a CSV column is the thing that could otherwise smuggle a
  field, and it is refused by name.
- **Per-cell length caps.** `ImportTemplateColumn.limit` carries a `TEXT_LIMITS`
  key per column, checked in one generic pass, precisely because the manual
  endpoints capped these fields through their normalizers and the import path
  did not.
- **The formula guard** on anything written back out as CSV
  (`tests/csv-formula-injection.test.ts`).
- **Row-level validation** per template (`validateUsersPreview` and its four
  siblings), and the fact that this route only ever produces a *preview*:
  nothing is written to the tenant's tables until `POST
  /jobs/:importJobId/confirm`, which takes no body at all.

And one honest limit, stated the same way the `visits` note stated its own: the
size of `csvText` stays bounded only by the 100 kB JSON body limit
(`JSON_BODY_LIMIT`, `src/common/input-limits.ts`). A body past that is refused
by body-parser with a 413 before any of this runs. This change neither improves
nor worsens that, and a `@MaxLength` here would restate a limit already enforced
one layer out — the thing this track forbids — while answering a 100 kB CSV with
a field error instead of the 413 it gets today.

So what the DTO *does* buy on this route is one thing, and it is worth having:
an undeclared property is refused by name rather than silently ignored. That is
the same property every other route on the track gained, applied at the layer
where this body's shape is known and fixed — three fields, all of them the
controller's own.

## Q3. `templateType` — gate the discriminator

**Decision: `@IsIn(IMPORT_TEMPLATE_TYPES)`, with the list moved to
`imports.types.ts` and `parseImportTemplateType` reading the same constant.**

This is the same call tier 4 made for `segmentTemplate` and the opposite of the
one it made for `colorScheme`/`language`, and the test is the one the track has
been using throughout: does the service's own refusal say more than a whitelist
rejection would? Here it does not — `IMPORT_TEMPLATE_INVALID` answers "Import
template type is required." without naming a single allowed value, which is
also slightly untrue for the case where a type *was* supplied and was simply
wrong.

Nor is this a dropped enum of the kind the earlier tiers found: an unknown type
throws rather than being coerced, so nothing silently changed shape. The reason
to gate it anyway is that `templateType` is the **discriminator** — it selects
which template definition the header is checked against and which of the five
row validators runs. A field that decides which validator applies is the one
field on this body worth pinning at the earliest possible layer.

The union type `ImportTemplateType` already exists in `imports.types.ts`; it
becomes derived from the new `IMPORT_TEMPLATE_TYPES` array so there is one list
rather than a list and a union that can drift.

## Q4. `fileName` — no length cap, deliberately

**Decision: `@IsString()`, no `@MaxLength`.**

This one departs from the two upload registrations already on the track
(`RegisterAudioUploadDto`, `RegisterLogoUploadDto`), which both cap `fileName`
at `MAX_UPLOAD_FILE_NAME_LENGTH`, so the difference deserves a sentence rather
than a silent inconsistency.

Those two normalizers **reject** an over-long name before sanitizing it.
`parseFileName` here does not: it slices to 255 and says why in its own comment
— "keep the original name for display, but cap it so an oversized client value
can't bloat the row; the column is nullable and purely informational". There is
no rejection to move earlier. Adding `@MaxLength(255)` would not surface a
hidden refusal, it would *invent* one, turning a cosmetic overflow into a failed
import of a file the admin already picked. Any looser number would be arbitrary,
and the value is truncated before it reaches the database either way, so an
uncapped string is bounded in practice by the same 100 kB body limit as
everything else here.

The same reasoning already kept `phone` uncapped in `locations` and
`admin-users`: where the service deliberately tolerates a value, the DTO must
not be the layer that stops tolerating it.

## Q5. Required-ness stays with the controller

All three fields are optional in the DTO, as everywhere on this track.
`parseImportTemplateType` and `parseCsvText` keep answering
`IMPORT_TEMPLATE_INVALID` / `IMPORT_FILE_INVALID` for a missing value, and
`parseCsvText` keeps owning the "present but blank" case — `csvText: "   "` is
whitespace a `@IsString()` cannot judge and an empty CSV is what the admin
actually needs to be told about.

## Rollout and verification

One PR; there is one route. Beyond the track's standard test shape (the real
`ValidationPipe.transform()` against the metadata Nest attaches to `@Body()`,
plus `PIPES_METADATA` on the gated handler **and** on all four ungated routes
of the same controller, `POST /jobs/:importJobId/confirm` included), two checks
are specific to `imports`:

- Pin **a real CSV body** — an actual template downloaded from
  `GET /imports/templates/:templateFile`, with rows — as accepted verbatim,
  including its trailing newline and quoted cells. Not a hand-written
  approximation, for the same reason the `visits` note asked for a captured
  payload.
- Pin that a `csvText` containing the things a whitelist reader might expect to
  be filtered — a formula-injection cell, a column the template does not
  declare — **passes the DTO** and is refused (or neutralized) by the layer that
  actually owns it. A test that only showed the DTO refusing bad input would
  misrepresent where this endpoint's defenses live, which is the whole subject
  of Q2.

## Open questions

1. **Is Q3 the right side of the line?** Gating `templateType` swaps a
   `IMPORT_TEMPLATE_INVALID` for a `VALIDATION_FAILED` on a wrong-but-present
   type. `apps/web` validates the value before posting and reads only
   `result.ok`, so no screen changes — but it is a contract change on a public
   error code, and the argument for it (it is the discriminator) is a judgement
   rather than a rule the track already had.
2. **Should the 100 kB ceiling be raised for this route specifically?** Out of
   scope here and not a validation question, but Q2 is the first place it has
   been written down that the largest legitimate body in the product is a CSV
   import posted as JSON, sharing a limit chosen for ordinary bodies.
