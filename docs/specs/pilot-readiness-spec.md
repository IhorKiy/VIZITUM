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

## Open questions for product owner

- Which tenant-level settings are needed before the first pilot: company name, default route visibility, allowed report types, products enabled, or something else?
- What are the default values for each tenant-level setting?
- Which roles can read and manage each setting?
- What exact steps must appear in the customer-admin one-page onboarding checklist?
- Which pilot success metrics are mandatory: visits completed, reports confirmed, manager tasks created, import success rate, AI draft rate, dashboard usage or others?
- What are the target thresholds and measurement window for each metric?
- Who is the incident contact during pilot week?
- What response window is promised for pilot issues?
- What issue triage labels should be used?
- Which events must be captured as evidence before moving from No-go to Go?

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
