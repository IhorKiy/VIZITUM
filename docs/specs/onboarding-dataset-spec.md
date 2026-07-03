# Onboarding Dataset Spec

Status: draft specification gate for Track B. This file captures what is known and what must be decided before building the remaining onboarding dataset work.

## Scope

The onboarding dataset covers the minimum customer data needed to start a `Vizitum Team Pilot` tenant:

- users;
- locations;
- contacts;
- products/SKUs;
- initial visit/task plan.

Existing import infrastructure already exposes these five import template types and validates rows before confirmation. The remaining Track B work is to finalize the product-level dataset, sample packs and field-level validation policy.

## Current contracts

- Import template types are fixed by `tests/import-templates.test.ts`.
- CSV parsing is covered by `tests/import-csv-parser.test.ts`.
- XLSX parsing is covered by `tests/import-xlsx-parser.test.ts`.
- Validate-preview-confirm behavior is covered by `tests/import-validation-preview.test.ts`.
- Tenant isolation still applies to every imported entity and job.

## Decisions

- Sample customer import packs must be synthetic. Do not include real customer names, phone numbers, commercial terms, addresses or notes.
- Import UX must continue to show row-level issues before apply/confirm.
- The first pilot remains a shared-database MVP; imported rows must be tenant-scoped from request context.

## Open questions for product owner

- What are the minimum required columns for each dataset: users, locations, contacts, products/SKUs and initial visit/task plan?
- Which columns are optional but recommended for better demo/pilot quality?
- Which validation issues should block confirmation, and which should be warnings?
- Should contacts be imported only through location-linked rows, or can they be imported independently and matched later?
- For products/SKUs, is `name` enough for the first pilot, or do we require SKU/category/external code?
- For the initial visit/task plan, what is the required planning unit: route date, representative, location, task, visit type, or a combined row?
- How many synthetic sample packs are needed for demo: one universal pack or one per segment template?
- Which countries/languages should the sample data use for the first pilot demo?

## Definition of ready

Track B implementation is ready only when:

- required/optional columns are approved for all five datasets;
- validation severity is approved for each field and relationship rule;
- sample pack scope is approved;
- new or changed behavior has focused tests;
- import reference docs and staging smoke steps are updated.

## Test expectations

Add or update tests when:

- a required column changes;
- a new import validation rule is added;
- sample pack generation or fixtures are introduced;
- a new import type or relationship rule is added;
- an import issue changes from warning to blocking error, or the reverse.
