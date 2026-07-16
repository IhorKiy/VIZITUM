export type PilotReviewThresholdStatus = "met" | "not_met" | "na";

export type PilotReviewThreshold = {
  key: string;
  label: string;
  target: string;
  result: string;
  status: PilotReviewThresholdStatus;
};

export type PilotReviewSummaryResponse = {
  firstVisitAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  // Tenant-wide: at least one route plan exists, i.e. an initial
  // visit/task plan has actually been created (not just the import template
  // shipping in code). Drives the pre-pilot readiness checklist.
  hasInitialPlan: boolean;
  thresholds: PilotReviewThreshold[];
  generatedAt: string;
};

export const DASHBOARD_VIEW_PAGES = ["manager", "admin_review"] as const;

export type DashboardViewPage = (typeof DASHBOARD_VIEW_PAGES)[number];

export type RecordDashboardViewRequestBody = {
  page?: unknown;
};
