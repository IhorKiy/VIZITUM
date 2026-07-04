# Executable Specification

This document maps behavior tests in `tests/` to product and platform rules that are already implemented. Treat these tests as executable specification: when a future change touches the same behavior, read the matching test before editing code and update the test in the same change if the intended behavior changes.

Design documents explain intent. This file records behavior that has been pinned by tests.

## How to use this map

- Start with this file when a task affects tenant isolation, imports, AI reporting, manual fallback, permissions, manager filters, storage, operations, logging or readiness.
- Use the listed tests to understand exact edge cases before relying on higher-level roadmap wording.
- Do not weaken or remove a tested rule unless the product decision is documented in the relevant spec or reference document.
- When adding Track B-E behavior, add or update a focused test and add it to this map.

## Product behavior contracts

| Test                                            | Contract                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/auth-tenant-isolation.test.ts`           | Tenant-owned access is scoped by request context, not client-provided tenant identifiers. Cross-tenant data must not leak.                          |
| `tests/routes-permissions.test.ts`              | Route reads and route mutations honor role permissions and representative scope. Team-wide route management is broader than own-route management.   |
| `tests/users-service.test.ts`                   | Company Admin user lifecycle behavior covers tenant-scoped users, invites, role assignment and status changes; a tenant can never be left without an active `company_admin` and a user can never be left with zero roles. |
| `tests/manager-list-filters.test.ts`            | Manager visit/task lists support operational filters without escaping tenant scope or changing list semantics.                                      |
| `tests/settings-service.test.ts`                | Tenant settings (company name, IANA time zone, products-applicable) validate input and persist correctly; only `company_admin` can read/manage them. |
| `tests/import-templates.test.ts`                | Downloadable onboarding templates exist for `users`, `locations`, `contacts`, `products` and `initial_visit_task_plan`; unsupported downloads fail. |
| `tests/import-csv-parser.test.ts`               | CSV import parsing handles supported CSV syntax and parser errors consistently.                                                                     |
| `tests/import-xlsx-parser.test.ts`              | XLSX import parsing maps workbook rows into the same validation path as CSV imports.                                                                |
| `tests/import-sample-pack.test.ts`              | The first-pilot synthetic sample import pack uses approved headers and parseable rows for every import template.                                    |
| `tests/import-validation-preview.test.ts`       | Imports use validate-preview-before-confirm semantics with row issues, counts and confirm eligibility.                                              |
| `tests/ai-extraction-schemas.test.ts`           | MVP AI extraction schemas exist for `distribution`, `service` and `partner_account`; outputs are strict and require user confirmation.              |
| `tests/ai-transcription-job.test.ts`            | Transcription jobs are tenant-scoped and produce controlled job states for audio note processing.                                                   |
| `tests/ai-extraction-job.test.ts`               | Extraction jobs use tenant/report template context and store draft output without creating final business objects by themselves.                    |
| `tests/ai-draft-confirmation.test.ts`           | AI draft confirmation is the point where confirmed report data and follow-up task creation become business state.                                   |
| `tests/manual-report-after-ai-failure.test.ts`  | Manual report confirmation must work even when AI failed and must not depend on reading failed AI job state.                                        |
| `tests/ai-failed-job-cleanup.test.ts`           | Failed AI job and temporary processing cleanup follows the retention behavior implemented by the worker cleanup path.                               |
| `tests/ai-draft-quality.test.ts`                | Weak-output criteria from `docs/specs/ai-quality-spec.md` are encoded: missing required fields, empty summary, invalid result status or confidence below 0.6 mark a draft `needs_review` instead of blocking the visit. |
| `tests/ai-extraction-evaluation.test.ts`        | Extraction evaluation harness: anonymized fixtures exist per MVP template, answer keys use approved fields/statuses, scoring is order/case-insensitive and the 80% pilot accuracy threshold is enforced. |
| `tests/visit-audio-upload-registration.test.ts` | Audio upload registration creates the note/storage metadata needed for browser recording or upload fallback.                                        |
| `tests/storage-service.test.ts`                 | Storage service behavior for S3-compatible objects, metadata and URL generation remains stable.                                                     |
| `tests/storage-signed-url.test.ts`              | Signed upload/download URL generation has controlled expiry and method semantics.                                                                   |
| `tests/operations-summary.test.ts`              | Operations summary exposes platform health counters through the allowed session or platform-token path.                                             |
| `tests/health-readiness.test.ts`                | Readiness and liveness behavior is explicit and preserves deployment health-check semantics.                                                        |
| `tests/json-logger.test.ts`                     | Structured logs preserve request and operational fields without leaking raw payload content.                                                        |
| `tests/sentry-service.test.ts`                  | Sentry integration behavior is controlled by configuration and error-reporting rules.                                                               |

## Track B-E coverage notes

Track B-E work is partly specified by this executable map and partly still requires product decisions.

- Track B, pilot data model completeness: existing tests cover current import template types, parsers, the first-pilot synthetic sample pack and validate-preview-confirm behavior. They do not yet define customer-specific sample packs.
- Track C, manager and admin workflows: existing tests cover user lifecycle, permissions and manager filters. Tenant-level settings are implemented, but future settings behavior still needs product decisions when adding new settings.
- Track D, AI reporting quality: existing tests cover strict schemas, AI job lifecycle, draft confirmation and manual fallback. They do not yet define quality thresholds, anonymized evaluation samples or weak-output scoring rules.
- Track E, commercial and pilot readiness: existing tests cover operations/readiness primitives. They do not yet define pilot success metrics, demo script acceptance or pilot-week support process.

When one of these notes says a behavior is not defined, the next agent must consult the matching spec in `docs/specs/` and ask the product owner for missing decisions before implementation.
