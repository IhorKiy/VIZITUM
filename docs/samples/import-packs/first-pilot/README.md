# First Pilot Sample Import Pack

This pack is synthetic demo data for preparing a Vizitum Team Pilot tenant.
It contains no real customer names, phone numbers, addresses, commercial
terms, or tenant identifiers.

Apply files in this order through the Company Admin import flow:

1. `users.csv`
2. `locations.csv`
3. `contacts.csv`
4. `products.csv`
5. `initial_visit_task_plan.csv`

The files use the approved first-pilot import headers from
`docs/specs/onboarding-dataset-spec.md` and are checked by
`tests/import-sample-pack.test.ts`.
