# Report Templates Spec

Status: draft specification gate for Track B and Track D. This file records report-template decisions that must be made before building editable template settings or changing AI extraction behavior.

## Scope

The MVP supports four report templates:

- `distribution`;
- `service`;
- `partner_account`;
- `medical` (field teams visiting doctors/medical staff).

They are configuration presets over the same core entities, not separate products or codebases.

## Current contracts

- `tests/ai-extraction-schemas.test.ts` requires schemas for all four MVP templates.
- AI schemas are strict: `additionalProperties` is false.
- AI output must include `requiresUserConfirmation` and `templateSpecific`.
- AI draft confirmation is covered by `tests/ai-draft-confirmation.test.ts`.
- Manual report confirmation remains available through `tests/manual-report-after-ai-failure.test.ts`.

## Decisions

- The first pilot must not add new selectable vertical presets beyond `distribution`, `service`, `partner_account` and `medical` (the latter added by product-owner decision, 2026-07-30, for pharma/medical field teams).
- AI-generated report data remains a draft until user confirmation.
- Tasks or location-card updates derived from AI output must not be applied before confirmation.
- First-pilot structured/queryable common fields are the current AI schema fields: `summary`, `resultStatus`, `agreements`, `objections`, `mentionedProducts`, `nextActions`, `tasksToCreate`, `locationUpdates`, `confidence`, `requiresUserConfirmation` and `templateSpecific`.
- First-pilot template-specific structured fields are:
  - `distribution`: `shelfAvailabilityNotes`, `competitorMentions`, `merchandisingIssues`, `orderIntent`.
  - `service`: `workPerformed`, `issuesFound`, `partsRequired`, `slaRisk`.
  - `partner_account`: `dealPotential`, `commercialTermsDiscussed`, `decisionMakers`, `nextMeetingSuggested`.
  - `medical`: `doctorsMet`, `keyMessagesDelivered`, `samplesOrMaterialsLeft`, `prescriptionIntent`.
- Free-text report content remains the manually entered or confirmed `summary`, `agreements`, `objections`, `nextActions`, template-specific note arrays and optional task/location-update descriptions. Raw audio and transcripts are temporary processing data, not report fields.
- First-pilot `resultStatus` values are exactly the current schema enums:
  - `distribution`: `completed`, `no_contact`, `postponed`, `issue_found`, `follow_up_required`.
  - `service`: `completed`, `issue_found`, `requires_follow_up`, `parts_required`, `client_unavailable`, `escalated`.
  - `partner_account`: `completed`, `agreement_reached`, `follow_up_required`, `objection_received`, `postponed`, `no_decision`.
  - `medical`: `completed`, `no_contact`, `postponed`, `follow_up_required`, `objection_received`.
- All current schema-required fields stay required in AI draft output. UI may hide advanced template-specific arrays from compact cards, but manager/report detail surfaces may show them after report detail UI exists.
- Company Admin allowed report-type selection is post-pilot. The first pilot keeps all four MVP templates available through existing backend schemas and operational flow.
- Minimum Manager report detail view for the first pilot: visit metadata, location, representative, template code, status/result status, confirmed summary, agreements, objections, mentioned products, next actions, created tasks count/details when available, location-update suggestions and confirmed timestamp.
- Pilot metrics and dashboard insights may use completed visits, confirmed reports, `resultStatus`, task creation/update counts, active representative coverage and import success. AI confidence, user edit rate and detailed template-specific fields are not mandatory first-pilot success metrics.
- Sensitive fields excluded from logs, exports by default and anonymized AI-quality samples: raw audio, transcripts, unredacted free-text notes, phone numbers, email addresses, commercial terms, personal names of customer contacts, exact street addresses and any customer-provided confidential identifiers. Manager-visible in-app reports may show tenant-owned operational data to authorized users.

## Open questions for product owner

None for the first pilot. Reopen this section only when changing AI schemas, adding editable report-type settings, or defining customer-specific report exports.

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
