# Staging UX Review

Use this record after staging smoke checks to decide whether the current frontend is acceptable for a controlled pilot.

Review date: 2026-07-02
Reviewed surface: repository frontend routes and staging smoke evidence
Tenant: `vizitum-staging`
Mitigation update: unavailable assisted-pilot action controls were disabled in the frontend after this review. The Field page now includes new visit creation, text note capture, browser voice recording with file upload fallback and a minimal manual report confirmation form for assigned visits.
Expanded smoke update: the 2026-07-02 staging recheck passed Field visit creation, text note, browser recording/upload and manual report confirmation, Admin template proxy/validation/confirm, plus Manager dashboard CSV export and task assignment. It did not fully clear self-serve readiness because audio file fallback failed on staging; a MIME alias fix is pending deploy and retest.

## Summary

The product-facing staging UX is close to a controlled pilot smoke pass: Field visit creation, browser recording/upload, manual report confirmation, Admin import template/validation/confirm, Manager dashboard export and Manager task assignment passed against staging. Audio file fallback needs a repeat smoke after the MIME alias fix deploy.

Before a self-serve customer pilot, rerun production-like smoke checks against staging with `docs/runbooks/expanded-staging-product-smoke.md` for the newly wired flows and keep the remaining operations token, alert and backup/restore gates tracked in the launch readiness record.

## Passed Smoke Surfaces

| Surface                    | Status  | Notes                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tenant login               | Pass    | Tenant-aware login posts `tenantSlug` to backend and forwards session cookies.                                            |
| Invite acceptance          | Pass    | Invite acceptance page exists and creates session after accepted invite.                                                  |
| Field page load            | Pass    | Authenticated session loads visits API and disables demo fallback by default in production; visit creation, text note and manual report passed on 2026-07-02. |
| Admin imports page load    | Pass | Page loads live templates; per-template downloads route through tenant-local Next proxy; one-row users import validated with 0 errors and confirmed with 1 applied row. |
| Manager dashboard load     | Pass    | Reads routes, visits and tasks, builds live aggregate cards, exports CSV and creates manager tasks when APIs return data. |
| Operations page load       | Partial | Page exists and live API path exists; operations bearer token env still needs verification.                               |
| Manual report confirmation | Pass    | Smoke report confirmation passed according to staging evidence packet.                                                    |

## Pilot-Blocking Issues

These should be resolved or explicitly accepted before inviting non-internal pilot users.

| Issue                                                         | Area       | Severity | Why It Matters                                                                                                              | Recommended Decision                                                                        |
| ------------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Audio file fallback failed on staging                         | Field      | Medium   | Existing audio upload is part of the self-serve field flow and some browsers label valid audio with MIME aliases.             | Deploy the MIME alias fix and repeat audio fallback with a manually selected audio file.     |
| Operations summary endpoint is not verified with bearer token | Operations | Medium   | Operations page may show connection-required state until `PLATFORM_OPERATIONS_TOKEN_SHA256` and alert check are configured. | Configure staging token env and rerun `npm run alerts:check` with `OPERATIONS_SUMMARY_URL`. |

## Non-Blocking UX Gaps

| Gap                                                    | Area          | Recommendation                                                                                                               |
| ------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Demo fallback exists for local development             | All app pages | Acceptable because production fallback is disabled by default. Keep `ENABLE_DEMO_FALLBACK` unset/false in production.        |
| Operations page is platform-oriented but tenant-routed | Operations    | Acceptable for internal operators during pilot; revisit if exposing to customer tenants.                                     |
| Import history list is not exposed yet                 | Admin imports | Current upload result is live; add a historical import jobs list only if self-serve admin onboarding needs audit visibility. |

## Recommended Pilot Scope

For the first controlled pilot, use one of these scopes.

### Assisted Pilot

Recommended for the current state.

- Vizitum team handles imports/setup.
- Field users can log in, create visits, record/upload voice notes and confirm manual reports after smoke recheck.
- Manager dashboard can be used for review, CSV export and task assignment after smoke recheck.
- Operations page is internal only.
- Production ops gates remain outside the product UI and must be completed before production pilot.

### Self-Serve Pilot

Do not use this scope until the newly wired product actions pass staging smoke and the relevant operations gates are configured or explicitly accepted.

Required before self-serve:

- production-like field smoke test for visit creation, audio upload and report confirmation;
- production-like import smoke test before broad self-serve rollout;
- production-like manager smoke test for CSV export and task assignment;
- operations token verification if operations page is used in pilot operations.

## Next Product Actions

1. Decide pilot scope: assisted pilot or self-serve pilot.
2. Deploy the audio fallback MIME alias fix and repeat file upload smoke using `docs/runbooks/expanded-staging-product-smoke.md`.
3. If self-serve pilot: keep browser recording in the accepted path and repeat audio fallback before rollout using the expanded smoke checklist.
4. Configure platform operations token and rerun alert check with operations summary.
5. Repeat UX review against staging after the chosen fixes.

## Action Plan Mapping

This review completes the planning artifact for: `Review the staging UX after smoke pass and list any pilot-blocking product issues`.

The original product UI blockers have been converted into implemented workflows. The remaining work is staging/production verification and external operations readiness.
