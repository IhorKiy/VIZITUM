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
  thresholds: PilotReviewThreshold[];
  generatedAt: string;
};

export const DASHBOARD_VIEW_PAGES = ["manager", "admin_review"] as const;

export type DashboardViewPage = (typeof DASHBOARD_VIEW_PAGES)[number];

export type RecordDashboardViewRequestBody = {
  page?: unknown;
};
