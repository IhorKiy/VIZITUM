# Pilot Demo Script

Live-demo script for a prospective or onboarding pilot customer. Source of truth for scope and order: `docs/specs/pilot-readiness-spec.md` ("The demo script must follow the latest accepted staging smoke path instead of a separate idealized flow.") and `docs/runbooks/expanded-staging-product-smoke.md`. Do not add steps that aren't already passing on staging.

Run this against a staging tenant seeded with realistic (non-production) sample data — see `docs/samples/import-packs/first-pilot/`. Do not use real customer data in a demo.

## Before you start

- [ ] Confirm staging API readiness returns `status=ready`.
- [ ] Confirm the demo tenant has: at least one active location, at least one Team Manager and one Field Representative user, and an initial route/task plan.
- [ ] Reset any in-progress demo visit from a prior run so the walkthrough starts clean.
- [ ] Have `docs/samples/import-packs/first-pilot/*.csv` open in a second tab in case you demo the import flow live.

## Part 1 — Company Admin: set up the tenant (~5 min)

Narrate as "this is the one-time setup a Company Admin does before the team starts using it."

1. **Log in** as the Company Admin. Point out the workspace is scoped to their company (`/{tenantSlug}`) — no cross-tenant visibility.
2. **Onboarding checklist** (`Setup`): show live setup progress (users, locations, products/SKUs, initial plan). This is the same checklist in `docs/runbooks/pilot-onboarding-checklist.md` that the customer's admin will complete themselves.
3. **Company settings** (`Settings`): show company display name, time zone, and the "Product/SKU tracking" toggle — explain this is off for teams that don't manage a product catalog.
4. **Imports** (`Imports`): download a template, upload a small sample CSV, show the validate-preview-then-confirm flow and the resulting import history entry. This is the fastest way a new customer gets their real locations/users/products into the system without manual entry.
5. **Users** (`Users`): show inviting a Field Representative, and the pending-invite/resend flow.

## Part 2 — Field Representative: a day in the field (~5 min)

Switch to (or log in as) a Field Representative account.

1. **Today's visits**: show the route summary and location cards for the day's plan.
2. **Start a visit** at one location.
3. **Add a text note**, then **record or upload a voice note** — narrate that audio/transcripts are temporary processing data, only the confirmed report is retained.
4. **Show the AI draft state messaging**: "Processing" → explain what happens if AI is slow or the output is weak (`When AI is weak` / `When AI is unavailable` panels) and that manual confirmation is always available — this is the reliability story, not a fallback of last resort.
5. **Confirm the report** (via AI draft confirm or the manual summary/next-steps fields) — point out the visit moves to Completed and the route summary updates live.
6. **Own tasks panel**: update a task status to show follow-up work assigned to this rep.
7. **Visit history**: filter by status/date to show past visits and confirmed reports.

## Part 3 — Team Manager: oversight and review (~5 min)

Switch to (or log in as) a Team Manager account.

1. **Manager dashboard**: live visits/reports/tasks metrics, representative summary, attention queue (blocked route items, high-priority tasks).
2. **Assign a follow-up task** from the dashboard — this is the loop-closing action: field visit → manager review → follow-up task.
3. **Visits and tasks drilldowns**: filter by route, representative, status, date range — show this is how a manager checks in on a specific rep or location without waiting for a report.
4. **Coverage** (`Coverage`) and **Reps** (`Reps`): read-only views for territory coverage and rep workload — useful for managers who don't need edit rights.
5. **Export**: download the CSV export of dashboard metrics.

## Part 4 — Pilot review (~3 min)

Back as Company Admin (or Team Manager, who also has access).

1. Open **Review** (`admin/review`).
2. Walk through the success thresholds: completed visits, confirmed reports, manager follow-up tasks, import success, active Field Representative coverage, manager review usage. Explain these are the exact numbers used to evaluate the pilot at the end of the measurement window (7 days from the first field visit — see `docs/specs/pilot-readiness-spec.md`).
3. Show the copyable summary — this is what gets pasted into the pilot review conversation with the customer.

## Wrap-up talking points

- Manual report confirmation always works, independent of AI availability — this is a hard product guarantee, not a degraded fallback.
- Every screen shown is scoped to the logged-in tenant and role; there is no cross-tenant data path.
- The pilot review numbers are computed automatically from the same data just demoed, not assembled manually after the fact.

## After the demo

- If this was a live pilot customer session, note any questions or requested changes and file them against `pilot-blocker`/`question` labels per `docs/runbooks/pilot-support-process.md`.
- If any step didn't match this script, treat it as a staging smoke regression and check `docs/runbooks/expanded-staging-product-smoke.md` before the next demo.
