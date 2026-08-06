# Design note: putting a DTO in front of `visits`

Status: decision note, written before the code · Date: 2026-08-04 · Scope: `VisitsController`'s eleven `@Body()` routes

> **The code shipped.** `visits.controller.ts` carries eleven
> `@UsePipes(createStrictValidationPipe())` call sites, one per gated body,
> landed across two changes — [`security-remediation-plan.md`](../security-remediation-plan.md)
> item 2.4 records it as done. Two of the three open questions below were
> answered by what shipped: **(1)** a malformed `products[]` entry is refused
> rather than dropped (`FieldReportProductDto` in `src/modules/ai/ai.dto.ts`
> makes `id` and `name` required, and `api-reference.md` records it as the one
> deliberate contract change on the track), and **(3)** the work went as two
> PRs. **(2) is still genuinely open** — whether the envelope-only gate on
> `confirmedData` is the permanent answer, or should be revisited once report
> schemas are versioned server-side. Everything else here is the record of why,
> not a plan of work (audit F19).

Item 2.4 of [security-remediation-plan.md](../security-remediation-plan.md) asked
for this note before the code, for one reason: `confirmedData` is "the
structured report whose shape is the AI extraction schema rather than a field
list, so a whitelist cannot reach inside it without duplicating that schema."
That question is answered below, along with four others the surface raises.
Everything here is a proposal; the last section lists what still needs a
decision from a human.

`visits` is the last module of tier 3 and the largest single controller on the
track: eleven write routes against the two-per-controller of the flat-CRUD
tier, and the field app's entire reporting path runs through it. The plan's own
warning — "a false rejection is a rep who cannot file a visit" — turns out to
understate the risk, which is the most important finding in this note.

## The surface

| Route | Body | Body type lives in | Handled by |
| ----- | ---- | ------------------ | ---------- |
| `POST /visits` | `locationId, visitType, representativeUserId?` (defaults to the caller)`, routeItemId?, startedAt?, clientVisitId?` | `visits.types.ts` | `VisitsService` |
| `PATCH /visits/:visitId` | `status?, startedAt?, completedAt?` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/cancel` | `reason, comment?` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/notes/text` | `textContent` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/notes/audio/register` | `fileName, contentType, sizeBytes, checksum?` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/problem-photos/register` | `fileName, contentType, sizeBytes` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/reports/confirm` | `confirmedData, schemaVersion?, clientRequestId?` | `visits.types.ts` | `VisitsService` |
| `POST /visits/:visitId/ai/transcription-jobs` | `inputObjectId` | `ai.types.ts` | `AiService` |
| `POST /visits/:visitId/ai/extraction-jobs` | `transcriptionJobId` | `ai.types.ts` | `AiService` |
| `POST /visits/:visitId/ai/drafts/confirm` | `extractionJobId, confirmedData?` | `ai.types.ts` | `AiService` |
| `POST /visits/:visitId/ai/field-report-transcriptions` | `audioObjectId, products[]` | `ai.types.ts` | `AiService` |

Two things follow from the right-hand columns. The AI routes are mounted on
`VisitsController` but owned by `AiService`, and three of them are the only
routes on this track whose body is parsed **in the controller** rather than in
a service (`parseRequiredBodyString`, `parseProductCatalog`) — so a DTO here
replaces controller code, a first. And `confirmedData` appears on two different
routes, reached by two different services.

## Q1. What "whitelisted" means for `confirmedData` — the central question

**Proposal: gate the envelope, and let `confirmedData` through as an opaque
object. `@IsObject()` and nothing deeper.**

### What it actually is

One route carries two unrelated shapes, chosen by `schemaVersion`:

- **`manual.v1`** — a flat `Record<string, string>` from the segment-template
  manual form. Its field list comes from the tenant's own `segmentTemplate`, so
  there is no single shape to declare: it varies per tenant.
- **`field-report.v1`** — the nested voice-report shape. Its authority is
  `FIELD_REPORT_EXTRACTION_SCHEMA` (`ai/field-report-extraction.schema.ts`),
  *plus* everything the form adds after extraction that the model never
  produces: `fieldReport.shelfChecked`, `fieldReport.productUpdates[]`,
  `fieldReport.problemPhotoObjectId`, `tasksToCreate[]`.

A DTO that described either would be a second copy of a contract that already
has one, and the plan is right that duplicating it is the cost. But duplication
is not the reason to decline — these two are:

### It buys nothing that isn't already there

Mass assignment is what the whitelist exists to stop, and `confirmedData`
cannot carry it. It is never spread into a Prisma `data` object; it is written
whole into one `Json` column (`Report.confirmedData`), and `tenantId`,
`locationId`, `representativeUserId` and `confirmedByUserId` on that row all
come from the request context and the visit. The three readers that reach
inside it — `extractShelfCheck`, `extractTasksToCreate`,
`problemPhotoObjectIdOf` — already check every step defensively (`isRecord`,
`typeof x === "string"`, `flatMap` dropping entries that don't match) rather
than casting, and each one's comment says so. There is no silent wrong write
hiding in there of the kind the earlier tiers found.

### And it can cost a rep their finished work

This is the decisive argument, and it is specific to this route.

`apps/web/lib/report-outbox.ts` stores a queued confirm — **the exact payload**
— in IndexedDB on the rep's phone, and replays it when signal returns. Its own
comment on a server refusal:

> Such an item is never retried automatically — the answer will not change on
> its own [...] It is kept rather than deleted, because deleting it would throw
> away work the rep already finished; the recovery is to reopen the visit and
> confirm again.

So a payload that a *previous build* of the client produced can arrive at a
*newer* server. If a whitelist refuses a property that build happened to
include, the outbox marks the entry `rejectedAt`, stops retrying, and the rep's
only recovery is to redo the report — for a visit whose audio is long gone.
The plan's "a false rejection is a rep who cannot file a visit" is the online
case; this is worse, because the work already exists and is destroyed by the
refusal. A whitelist over a body that is stored on devices and replayed across
deploys is a versioning problem wearing a validation problem's clothes.

### What the envelope gate still gets us

Declaring `confirmedData`, `schemaVersion` and `clientRequestId` and refusing
anything else on `POST /visits/:visitId/reports/confirm` is worth doing on its
own: it is the same anti-mass-assignment property as every other route on the
track, applied at the layer where the shape *is* known and fixed. `@IsObject()`
also agrees with `normalizeJsonObject` on everything a JSON body can carry —
both accept a non-null, non-array object and reject the rest (class-validator's
`isObject` additionally admits a function, which JSON cannot produce) — so
`REPORT_INVALID`'s "confirmed report data must be a JSON object" keeps its
meaning rather than being pre-empted by a different one.

**Honest limit to write down:** the size of `confirmedData` stays bounded only
by the 100 kB JSON body limit. That is true today and this change does not
improve it.

## Q2. `products[]` — the nested case tier 3 was actually promised

`POST /visits/:visitId/ai/field-report-transcriptions` takes
`products: Array<{ id, name, sku, category }>` — the tenant's catalog, sent by
the client so the model can match spoken product names against it. `routes` and
`route-templates` turned out to hold only arrays of ids
([the tier-3 note in the plan](../security-remediation-plan.md)); **this** is
the one body on the whole track that wants `@ValidateNested({ each: true })`
plus `@Type(() => FieldReportProductDto)`.

One behaviour question comes with it. `parseProductCatalog` today **silently
drops** an entry missing `id` or `name` and transcribes with a smaller catalog.
A DTO would refuse the whole request instead. Recommending the refusal: the
client builds this list from the API's own products response, so a malformed
row is a client bug rather than user input, and a silently smaller catalog
means worse extraction with no signal — the same silent-wrong-answer family the
earlier tiers found. Flagged in the open questions because it is a contract
change on the field app's critical path.

## Q3. `sizeBytes` must not be narrowed, and must stay the service's error

Item 3.2 made the declared size **mandatory** at all three registration paths,
because `createPresignedObjectUrl` signs `Content-Length` and an undeclared
size cannot be signed. Two consequences for the DTO:

- `normalizeAudioSizeBytes` accepts **a number or a numeric string**. Declaring
  `@IsInt()` alone would refuse `"1048576"` and make the presigned PUT
  unsignable for any client that sends it as a string — exactly the failure the
  plan warns about. Use the number-or-string idiom already established for
  `latitude`/`longitude` in `locations.dto.ts` (`@ValidateIf` stepping aside for
  strings), and import the caps from `visits/visit-media-limits.ts` — the two
  routes do not share one (`MAX_TEMPORARY_AUDIO_SIZE_BYTES` is 50 MB,
  `MAX_PROBLEM_PHOTO_SIZE_BYTES` is 10 MB) — rather than restating either.
- Keep the field **optional in the DTO** so a missing size is still
  `AUDIO_UPLOAD_SIZE_INVALID` from the service, whose message names the limit.

## Q4. Where the classes live

**Proposal: two files — `src/modules/visits/visits.dto.ts` (six classes) and
`src/modules/ai/ai.dto.ts` (five classes)** — mirroring where the body types and
the owning services already sit, even though one controller imports both. A
single `visits.dto.ts` holding all eleven would put AI contracts in a module
that does not own them, and `ai.types.ts` is where the next person will look.

## Q5. Two enums where the DTO should deliberately *not* be the gate

The dropped-enum tightening applies here as everywhere — but twice, the
service's own refusal is more useful than a whitelist rejection, so the DTO
should stay wider than the set:

- **`PATCH /visits/:visitId` `status`.** `normalizeVisitStatus` recognises
  `draft`/`in_progress`/`completed` and drops the rest (the usual silent no-op,
  worth tightening). But `status: "cancelled"` is checked *before* that and
  answers "Use POST /visits/:visitId/cancel to cancel a visit."
  So `@IsIn(["draft", "in_progress", "completed", "cancelled"])` — include the
  value the route refuses, so the caller keeps being told where to go instead of
  getting a bare `VALIDATION_FAILED`.
- **`POST /visits/:visitId/cancel` `reason`.** `normalizeCancellationReason`
  already throws `CANCELLATION_REASON_INVALID` with a message enumerating every
  allowed reason. `@IsString()` only, and leave the set to the service.

## Proposed rollout

Two PRs rather than one, split on where the risk is:

1. **The six `VisitsService` bodies** — create, update, cancel, text note, both
   registrations. Ordinary tier-2-shaped work; the only subtlety is Q3 and Q5.
2. **The five `AiService` bodies** — including both `confirmedData` envelopes
   and the `products[]` nesting. This is the PR that carries Q1 and Q2, and the
   one whose review should be about replay compatibility rather than about
   validators.

Beyond the usual test plan for this track (real `ValidationPipe.transform()`
against the metadata Nest attaches to `@Body()`, plus `PIPES_METADATA` on every
handler), two checks are specific to `visits`:

- Pin **a real captured payload of each `schemaVersion`** — one `manual.v1`,
  one `field-report.v1` including `productUpdates` and `tasksToCreate` — as
  accepted verbatim. Not a hand-written approximation.
- Take a payload out of a device outbox (or the shape `report-outbox.ts`
  stores) and replay it against the gated endpoint before merging. The offline
  path is the one this change can break invisibly.

## Open questions

1. **`products[]`: refuse a malformed entry, or keep silently dropping it?**
   Recommending refuse; it is a contract change on the field app's transcription
   path and deserves an explicit yes.
2. **Is the envelope-only gate on `confirmedData` acceptable as the permanent
   answer**, or should it be revisited once report schemas are versioned
   server-side? The note argues the offline replay path makes a deep whitelist
   wrong in principle here, not merely expensive — but that reasoning is worth
   disagreeing with explicitly if someone does.
3. **One PR or two?** The split above is a recommendation, not a requirement.
