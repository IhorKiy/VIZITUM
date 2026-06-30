# Production Launch Readiness Record

Use this record before starting a production pilot. It collects evidence from deployment, alerts, restore drill, smoke checks and known launch risks.

## Launch Metadata

- Launch id:
- Target launch date:
- Release SHA:
- Environment:
- Operator:
- Reviewer:
- Business owner:
- Pilot tenant(s):

## Required Evidence

| Area               | Required Evidence                                                                                                | Status | Link/Notes |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| CI                 | Latest `main` checks pass                                                                                        |        |            |
| Deployment         | `docs/runbooks/production-deployment.md` completed                                                               |        |            |
| API readiness      | `/api/health/readiness` returns ready                                                                            |        |            |
| Alerts             | `docs/runbooks/production-alerts.md` readiness verification completed                                            |        |            |
| Restore drill      | `docs/runbooks/restore-drill-record-template.md` completed                                                       |        |            |
| Backups            | Automated backups and retention confirmed                                                                        |        |            |
| Sentry             | API, web and worker release tags visible                                                                         |        |            |
| Cleanup worker     | Latest scheduled cleanup run succeeded                                                                           |        |            |
| Operations summary | `/api/operations/summary` returns aggregate counters and the web operations page renders for an operator account |        |            |
| Smoke checks       | Login, tenant lookup, field, imports, manager dashboard, manual report confirmation pass                         |        |            |
| Data protection    | Raw audio/transcript retention policy verified                                                                   |        |            |

## Open Risks

| Risk | Severity | Owner | Mitigation | Launch Blocking |
| ---- | -------- | ----- | ---------- | --------------- |
|      |          |       |            |                 |

## Go / No-Go

- [ ] Go: launch can proceed.
- [ ] No-go: launch is blocked.

Decision owner:

Decision timestamp:

Follow-up actions:
