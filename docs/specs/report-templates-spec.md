# Report Templates Spec

Status: draft specification gate for Track B and Track D. This file records report-template decisions that must be made before building editable template settings or changing AI extraction behavior.

## Scope

The MVP supports three report templates:

- `distribution`;
- `service`;
- `partner_account`.

They are configuration presets over the same core entities, not separate products or codebases.

## Current contracts

- `tests/ai-extraction-schemas.test.ts` requires schemas for all three MVP templates.
- AI schemas are strict: `additionalProperties` is false.
- AI output must include `requiresUserConfirmation` and `templateSpecific`.
- AI draft confirmation is covered by `tests/ai-draft-confirmation.test.ts`.
- Manual report confirmation remains available through `tests/manual-report-after-ai-failure.test.ts`.

## Decisions

- The first pilot must not add new selectable vertical presets beyond `distribution`, `service` and `partner_account`.
- AI-generated report data remains a draft until user confirmation.
- Tasks or location-card updates derived from AI output must not be applied before confirmation.

## Open questions for product owner

- For each template, which fields must be structured and queryable by managers?
- Which fields should remain free-text notes?
- Which `resultStatus` values are acceptable for each template in the first pilot?
- Which template-specific fields are required, optional or hidden in the UI?
- Should Company Admins be able to choose allowed report types per tenant before the first pilot, or is that a post-pilot setting?
- What is the minimum report detail view needed for Manager review?
- Which fields can be used for pilot success metrics and dashboard insights?
- Which fields are sensitive and should be excluded from logs, exports or anonymized AI-quality samples?

## Definition of ready

Report-template implementation is ready only when:

- structured versus free-text fields are approved per template;
- enum/status values are approved;
- manager-visible and export-visible fields are approved;
- AI schema changes have tests;
- manual fallback accepts the same required business fields as AI confirmation.

## Test expectations

Add or update tests when:

- template-specific schema fields change;
- `resultStatus` enums change;
- a field becomes required for confirmation;
- confirmed AI output creates tasks or other side effects;
- report visibility or export behavior changes.
