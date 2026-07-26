import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisitsController } from "../src/modules/visits/visits.controller";

// NestJS resolves a controller's routes in method declaration order: a
// literal-path route declared after a same-level :param route gets swallowed
// by it. getVisitDaySummary (GET /visits/day-summary) must stay declared
// ahead of getVisit (GET /visits/:visitId), or a request for "day-summary"
// resolves as visitId="day-summary" instead of reaching the summary
// endpoint. Only a code comment guarded this before; pin it here so a
// reorder during a future edit fails the suite instead of failing silently
// in production.
describe("visits controller route order", () => {
  it("declares day-summary ahead of the :visitId route", () => {
    const methodNames = Object.getOwnPropertyNames(VisitsController.prototype);
    const daySummaryIndex = methodNames.indexOf("getVisitDaySummary");
    const visitIdIndex = methodNames.indexOf("getVisit");

    assert.ok(daySummaryIndex >= 0, "getVisitDaySummary must exist");
    assert.ok(visitIdIndex >= 0, "getVisit must exist");
    assert.ok(
      daySummaryIndex < visitIdIndex,
      "getVisitDaySummary must be declared before getVisit",
    );
  });
});
