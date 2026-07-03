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

## Open questions for product owner

- What counts as weak AI output for the first pilot: missing required fields, low confidence, contradictions, unsupported language, empty transcript or unsafe content?
- Do we need a numeric confidence score, categorical quality state, or both?
- Which weak-output states should Field Representatives see?
- Which weak-output states should Managers or Company Admins see?
- What anonymization rules must be applied before storing staging examples for evaluation?
- How long can anonymized examples be retained?
- Who can review anonymized examples?
- What is the expected-field answer key for each supported report type?
- What acceptance threshold is good enough for pilot use: per-field accuracy, whole-report acceptance, user edit rate or confirmation rate?
- How should AI failures be counted in pilot review metrics versus manual fallback success?

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
