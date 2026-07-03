# Feature Specification Gates

This document defines the specification gate for roadmap Tracks B-E. Those tracks include product decisions that cannot be safely inferred from existing code alone.

Before implementing any Track B-E item, agents must identify whether the target behavior is already fixed by tests, documented as a product decision, or still open. If it is open, ask the product owner for clarification before coding.

## Gate states

| State | Meaning | Agent action |
| --- | --- | --- |
| Executable contract | Behavior is covered by a test listed in `docs/reference/executable-spec.md`. | Read the test first. Preserve the behavior unless a documented product decision changes it. |
| Documented decision | Behavior is written as a decision in a spec or reference doc, but may not have code yet. | Implement against the decision and add/update tests for edge cases. |
| Open product question | Direction exists, but exact behavior is not specified. | Ask the product owner. Do not invent the rule from code shape or design intent. |
| Deferred | Behavior is intentionally not part of the current development phase. | Leave it out unless the roadmap item is explicitly reactivated. |

## Track B: Pilot data model completeness

Spec: `docs/specs/onboarding-dataset-spec.md`

Current executable contracts:

- Import template types: `users`, `locations`, `contacts`, `products`, `initial_visit_task_plan`.
- CSV/XLSX parsing feeds validation-preview behavior.
- Import confirmation happens only after validation preview.

Gate before implementation:

- Minimum required/optional fields must be approved for each onboarding dataset.
- Row-level validation severity must be approved: blocking error, warning or ignored.
- Sample customer packs must be synthetic and must not include real customer data.
- Any new import type must update `docs/reference/api-reference.md`, `docs/reference/module-map.md`, tests and smoke steps.

## Track C: Manager and admin workflows

Spec: `docs/specs/pilot-readiness-spec.md` for operational readiness decisions; implemented API references remain in `docs/reference/api-reference.md`.

Current executable contracts:

- Company Admin user lifecycle is tenant-scoped.
- Manager visit/task filters preserve operational list behavior.
- Route permissions distinguish team-wide management from own-route management.

Gate before implementation:

- New tenant settings need an owner-approved default and permission model.
- Team Manager full tenant view means operational read access, not Company Admin rights.
- Navigation remains permission-aware for users with multiple roles.

## Track D: AI reporting quality

Spec: `docs/specs/ai-quality-spec.md` and `docs/specs/report-templates-spec.md`

Current executable contracts:

- Supported MVP templates are `distribution`, `service` and `partner_account`.
- AI output schemas are strict and require user confirmation.
- AI output does not create final reports or tasks until confirmation.
- Manual confirmation remains available when AI fails.

Gate before implementation:

- Weak-output criteria must be approved before adding quality scoring or UI states.
- Anonymized staging examples must have a retention and redaction rule before collection.
- Structured fields versus free-text fields must be approved per report template.
- Manual report fallback must remain a first-class path in every pilot flow.

## Track E: Commercial and pilot readiness

Spec: `docs/specs/pilot-readiness-spec.md`

Current executable contracts:

- Operations summary and readiness endpoints expose the current platform health signals.
- Pilot review screen exists, but commercial acceptance metrics still need owner-approved thresholds.

Gate before implementation:

- Pilot success metrics must include exact thresholds and measurement windows.
- Demo script steps must match the accepted staging smoke path.
- Pilot-week support process must define incident contact, response window and issue labels.
- Paid PostgreSQL backup/restore remains a final production-pilot gate, not a blocker for current Track B-E development.

## Required change pattern

For Track B-E changes:

1. Read the matching `docs/specs/*` file.
2. Read any tests listed in `docs/reference/executable-spec.md` for the touched behavior.
3. If the spec has open questions that affect the change, ask the product owner before coding.
4. Move answered questions into the spec's `Decisions` section.
5. Add or update tests for thin behavioral rules.
6. Update `docs/vizitum-action-plan.md` and any affected `docs/reference/*` documents in the same change.
