import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { LocationAssortmentController } from "../src/modules/location-insights/location-assortment.controller";
import { LocationInsightsSummaryController } from "../src/modules/location-insights/location-insights-summary.controller";
import { LocationPotentialController } from "../src/modules/location-insights/location-potential.controller";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const manageAnyPermissions = [
  PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
  PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
];

// Guards against the two-controllers-sharing-the-"locations"-prefix route
// table ever silently colliding with LocationsController's own routes — this
// codebase never boots a real Nest app in tests, so nothing else would catch
// an accidental (method, path) collision at test time.
describe("location insights permissions", () => {
  it("requires location_insights.read on every read endpoint", () => {
    const readHandlers = [
      LocationPotentialController.prototype.listPotential,
      LocationAssortmentController.prototype.listAssortment,
      LocationInsightsSummaryController.prototype.getSummary,
    ];

    for (const handler of readHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.LOCATION_INSIGHTS_READ],
        `${handler.name} must require location_insights.read`,
      );
    }
  });

  it("requires a manage permission on every write endpoint", () => {
    const writeHandlers = [
      LocationPotentialController.prototype.upsertPotential,
      LocationPotentialController.prototype.deletePotential,
      LocationAssortmentController.prototype.upsertAssortment,
      LocationAssortmentController.prototype.deleteAssortment,
    ];

    for (const handler of writeHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
        manageAnyPermissions,
        `${handler.name} must require location_insights.manage or location_insights.manage_own`,
      );
    }
  });
});
