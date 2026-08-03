import "reflect-metadata";
import { IsIn } from "class-validator";

import {
  DASHBOARD_VIEW_PAGES,
  type DashboardViewPage,
} from "./pilot-review.types";

/**
 * Next module on the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to PilotReviewController alone
 * via createStrictValidationPipe(). page is required — unlike the other
 * modules on this track, this endpoint has no optional fields to whitelist,
 * just one value that must be a real dashboard page. DASHBOARD_VIEW_PAGES is
 * imported rather than restated so this list and normalizeDashboardViewPage's
 * own check (pilot-review.controller.ts, still run afterward, unchanged)
 * can't drift apart.
 */
export class RecordDashboardViewDto {
  @IsIn(DASHBOARD_VIEW_PAGES)
  page!: DashboardViewPage;
}
