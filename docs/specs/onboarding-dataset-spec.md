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
- First-pilot required columns are the existing template-required columns:
  - `users`: `email`, `name`, `roles`.
  - `locations`: `name`, `address_line`, `city`.
  - `contacts`: `name`, plus one resolvable location reference from `location_external_code` or `location_name`.
  - `products`: `name`.
  - `initial_visit_task_plan`: `representative_email`, one resolvable location reference from `location_external_code` or `location_name`, `plan_date`.
- First-pilot recommended optional columns are:
  - `users`: `phone`, `external_code`.
  - `locations`: `external_code`, `type`, `region`, `territory`, `latitude`, `longitude`, `assigned_representative_email`, `notes`.
  - `contacts`: `role_title`, `phone`, `email`, `notes`.
  - `products`: `external_code`, `sku`, `category`.
  - `initial_visit_task_plan`: `sequence`, `planned_start_time`, `planned_end_time`, `task_title`, `task_due_date`, `task_priority`.
- Blocking import errors: missing required fields, invalid email/date/time/coordinate values, unsupported role or task priority, unresolved representative/location references, duplicate tenant-unique email or external code, and disabled product imports when products are not applicable.
- Import warnings: duplicate-looking location name/address, optional missing phone/SKU/category/region/territory/notes, and incomplete optional task fields when the plan row itself is otherwise valid.
- Contacts are imported only as location-linked rows for the first pilot. Independent unmatched contacts are out of scope until there is a contact matching workflow.
- Product/SKU imports require only `name` for the first pilot. SKU, category and external code improve review/search quality but do not block import.
- The initial visit/task plan uses one combined row per representative-location-plan date. A task can be created from the same row when `task_title` is provided; otherwise the row creates only route/visit planning data.
- Demo sample data uses one universal synthetic Ukraine-oriented sample pack in English/Ukraine-compatible naming for the first pilot. Segment-specific sample packs are deferred until a real customer segment needs them.

## Open questions for product owner

None for the first pilot. Reopen this section only when adding a new import type, changing required columns, or introducing real customer sample packs.

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
