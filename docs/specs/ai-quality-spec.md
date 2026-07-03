# AI Quality Spec

Status: draft specification gate for Track D. This file prevents agents from inventing AI quality rules from current code shape.

## Scope

AI quality work covers:

- anonymized staging examples;
- evaluation of extraction output against expected structured fields;
- weak-output confidence/error states;
- manual confirmation and manual fallback behavior.

## Current contracts

- AI extraction schemas are strict and template-specific.
- AI jobs create drafts, not final business state.
- AI draft confirmation is user-controlled.
- Manual report confirmation must work even when AI transcription or extraction fails.
- Raw audio, transcripts and AI outputs must not be written to logs.

## Decisions

- Manual report fallback is reliable product behavior, not an error-only escape hatch.
- AI output cannot silently change final reports, tasks or location data.
- Weak AI output must lead users toward review, correction or manual confirmation rather than blocking visit completion.
- First-pilot weak AI output is any draft with one or more of: empty or unusable transcript, missing schema-required fields, low confidence below `0.6`, internal contradictions, unsupported/garbled language, unsafe content, or extraction failure/timeout.
- First-pilot quality state is categorical, with optional numeric confidence shown only when already produced by the extraction schema. Do not introduce a separate scoring model before the first pilot.
- Field Representatives see these states: `Processing`, `Needs review`, `Manual fallback available`, `Ready to confirm` and `Confirmed`. Weak output must always keep manual confirmation available.
- Managers and Company Admins see only operationally useful states in first-pilot views: confirmed report, pending/needs review, AI failed or manual fallback used. They do not need raw confidence scoring before report detail/evaluation views exist.
- Anonymized AI-quality examples may be stored only after removing or replacing names, phone numbers, emails, exact addresses, commercial terms, tenant/customer identifiers, raw audio and raw transcripts. Examples must retain only the minimum text needed to evaluate extraction quality.
- Anonymized evaluation examples may be retained for up to 90 days during pilot evaluation, then deleted or re-approved for a longer retained benchmark set.
- Review access for anonymized examples is limited to product owner/operator and engineers working on AI quality. Customer-visible review requires a separate pilot agreement or DPA/addendum approval.
- Expected-field answer keys for first-pilot evaluation follow the approved report-template fields in `docs/specs/report-templates-spec.md`.
- First-pilot acceptance threshold is pragmatic, not launch-blocking: at least 80% of evaluated required structured fields correct on anonymized pilot examples, zero silent finalization without user confirmation, and manual fallback success counted as a successful visit/report path rather than an AI failure.
- AI failures count as AI-quality events, not pilot workflow failures, when the Field Representative can still confirm a manual report and managers can review the completed visit.

## Open questions for product owner

None for the first pilot. Reopen this section only when storing real anonymized examples, adding evaluation fixtures, or changing user-visible AI quality states.

## Definition of ready

AI-quality implementation is ready only when:

- weak-output states are approved;
- evaluation examples and retention rules are approved;
- expected structured fields are approved per report template;
- user-facing copy preserves manual fallback;
- tests cover the new quality state transitions or scoring rules.

## Test expectations

Add or update tests when:

- a new AI job state is introduced;
- weak-output criteria are encoded;
- confidence or quality labels are stored;
- AI evaluation fixtures are added;
- UI/API behavior changes for failed, weak, delayed or unavailable AI processing;
- manual fallback interaction changes.
