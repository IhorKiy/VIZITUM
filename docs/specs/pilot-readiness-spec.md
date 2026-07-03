# Pilot Readiness Spec

Status: draft specification gate for Track C and Track E. This file captures commercial and operational readiness decisions that are not fully specified by code.

## Scope

Pilot readiness covers:

- tenant-level settings that affect pilot behavior;
- demo script based on the accepted staging smoke path;
- one-page customer-admin onboarding checklist;
- pilot success metrics;
- pilot-week support process.

## Current contracts

- Company Admin user lifecycle is implemented and tested.
- Manager visit/task filters are implemented and tested.
- Operations summary and readiness endpoints are implemented and tested.
- The pilot review summary screen exists, but some commercial thresholds still need owner-approved definitions.

## Decisions

- Team Manager full tenant view means operational read access, not Company Admin rights.
- Paid PostgreSQL backup/export/PITR and restore drill are deferred to the final production-pilot gate, not the current development phase.
- The demo script must follow the latest accepted staging smoke path instead of a separate idealized flow.
- First-pilot tenant settings are limited to company display name, IANA time zone and products-applicable. Default route visibility and allowed report types are not editable tenant settings before the first pilot.
- First-pilot tenant setting defaults: company display name comes from tenant provisioning, time zone defaults to `Europe/Kiev` unless explicitly provided during provisioning, and products-applicable defaults to `true`.
- Company Admin can read and manage tenant settings. Team Manager and Field Representative cannot read or manage tenant settings unless they also hold Company Admin permissions.
- Allowed report types are fixed to `distribution`, `service` and `partner_account` for the first pilot. Company Admin report-type selection is post-pilot unless a pilot customer explicitly requires it.
- The customer-admin onboarding checklist must include: confirm company/time zone/product applicability, invite or activate at least one Team Manager and one Field Representative, import or create active locations, import products or mark products not applicable, import or create an initial visit/task plan, complete one field visit with a confirmed report, and review manager dashboard/pilot review output.
- Mandatory pilot success metrics for the first pilot are: completed visits, confirmed reports, manager follow-up tasks created or updated, successful import application, active Field Representative coverage, and manager review usage.
- Pilot measurement window is seven calendar days from the first real field visit in the pilot tenant.
- First-pilot target thresholds: at least 5 completed visits or 80% of planned visits completed, whichever is lower for the pilot plan; 100% of completed visits have confirmed reports; at least one manager follow-up task is created or updated; import apply succeeds with zero partial writes and at least 90% valid rows after customer correction; at least one active Field Representative records work; at least one Team Manager opens dashboard/review output during the window.
- Pilot-week incident contact is Ihor Kiyanych as product owner/operator until a customer-specific contact is named in the pilot agreement.
- Pilot-week response windows: same business day for normal issues, within 4 business hours for blocked field/admin work, and best-effort immediate response for security, data loss, authentication outage or production availability incidents.
- Pilot issue labels are `pilot-blocker`, `pilot-critical`, `field-flow`, `manager-review`, `admin-import`, `ai-reporting`, `ops-readiness`, `data-correction` and `question`.
- No-go to Go evidence must include staging or production smoke evidence for the accepted path, API readiness output, web availability output, import confirmation evidence, at least one field visit/report evidence item, manager dashboard/review evidence, operations summary check when token is configured, Sentry event/release evidence before production pilot, and backup/restore evidence only at the final production-pilot gate.

## Open questions for product owner

None for the first pilot. Reopen this section only when a customer-specific pilot agreement changes support contacts, thresholds, settings or evidence requirements.

## Definition of ready

Pilot readiness implementation is ready only when:

- settings defaults and permissions are approved;
- demo script steps are approved against the staging smoke path;
- success metrics include exact thresholds and measurement windows;
- support contacts, response windows and labels are approved;
- new behavior has tests or a documented manual smoke step.

## Test expectations

Add or update tests when:

- tenant settings affect API behavior or navigation;
- pilot metrics are computed from platform data;
- operations summary counters change;
- readiness gates become machine-checkable;
- manager/admin workflow permissions change.
