# Pilot-Week Support Process

Support process for the 7-day pilot measurement window (see `docs/specs/pilot-readiness-spec.md`). Content here is fixed by that spec — do not change contacts, response windows or labels without a product-owner decision or a customer-specific pilot agreement.

## Contact

- **Pilot-week incident contact**: Ihor Kiyanych, product owner/operator, until a customer-specific contact is named in the pilot agreement.
- Share this contact with the customer admin during onboarding (see `docs/runbooks/pilot-onboarding-checklist.md`).

## Response windows

| Issue type | Response window |
| --- | --- |
| Normal issue (question, minor bug, cosmetic) | Same business day |
| Blocked field or admin work (a user cannot complete a core task) | Within 4 business hours |
| Security, data loss, authentication outage, or production availability incident | Best-effort immediate response |

## Issue labels

Apply exactly one primary label from this set when triaging a pilot-week issue. Labels are fixed by the spec, not invented per-issue:

- `pilot-blocker` — stops the pilot from continuing (e.g. a core flow is broken for the pilot tenant).
- `pilot-critical` — severely degrades the pilot but has a workaround.
- `field-flow` — Field Representative screens (visits, notes, AI/manual report confirmation).
- `manager-review` — Team Manager dashboard, drilldowns, task assignment, pilot review.
- `admin-import` — Company Admin screens, imports, settings, user lifecycle.
- `ai-reporting` — AI transcription/extraction/draft quality, not routing/auth issues that happen to touch a visit.
- `ops-readiness` — staging/production infra, alerts, backups, readiness endpoints.
- `data-correction` — a customer needs data fixed or corrected outside normal in-app flows.
- `question` — no code change needed, just an answer.

## Triage flow

1. Log the issue (GitHub issue or equivalent) with the primary label above.
2. Route by response window: `pilot-blocker` and security/data-loss/auth/availability incidents page the incident contact immediately regardless of business hours; everything else follows the table above.
3. If the fix requires a deploy, follow `docs/runbooks/production-deployment.md`; if it only needs a data correction, do not bypass tenant isolation — use the same tenant-scoped tooling the product uses, never a raw cross-tenant query.
4. Confirm the fix against the specific pilot tenant before closing, not just against staging in general.
5. If the issue reveals a genuine spec gap (not just a bug), open the relevant `docs/specs/*` file's "Open questions for product owner" section rather than deciding unilaterally.

## What to tell the customer (copy/paste)

> During your pilot week, reach out to Ihor Kiyanych with any issue. Normal questions get a same-business-day response; anything blocking your team's field or admin work gets a response within 4 business hours; security or availability issues get an immediate best-effort response.
