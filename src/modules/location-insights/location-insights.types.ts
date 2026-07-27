import type { AssortmentStatus, ProductStatus } from "@prisma/client";

export type LocationPotentialCategorySummary = {
  id: string;
  name: string;
};

export type LocationPotentialResponse = {
  id: string;
  locationId: string;
  productCategoryId: string;
  productCategory: LocationPotentialCategorySummary;
  potentialDate: string | null;
  potentialAmount: number | null;
  planMonth1: number | null;
  planMonth2: number | null;
  planMonth3: number | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListLocationPotentialResponse = {
  items: LocationPotentialResponse[];
  canManage: boolean;
};

export type UpsertLocationPotentialRequestBody = {
  potentialDate?: unknown;
  potentialAmount?: unknown;
  planMonth1?: unknown;
  planMonth2?: unknown;
  planMonth3?: unknown;
  comment?: unknown;
};

export type LocationAssortmentProductSummary = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  status: ProductStatus;
};

export type LocationAssortmentResponse = {
  id: string;
  locationId: string;
  productId: string;
  product: LocationAssortmentProductSummary;
  shouldBeListed: boolean;
  // Null until a visit confirms the product on the shelf; the manager who
  // authored the row never sets it.
  status: AssortmentStatus | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListLocationAssortmentResponse = {
  items: LocationAssortmentResponse[];
  canManage: boolean;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
};

// The manager authors the matrix and nothing else: shelf state (status,
// lastCheckedAt) is written by visit reports, never through this endpoint.
export type UpsertLocationAssortmentRequestBody = {
  shouldBeListed?: unknown;
};

export type LocationInsightsLocationSummary = {
  locationId: string;
  name: string;
  totalPotential: number;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
};

export type LocationInsightsProblemProduct = {
  productId: string;
  name: string;
  sku: string | null;
  problemCount: number;
};

export type LocationInsightsCategoryPotential = {
  productCategoryId: string;
  name: string;
  totalPotential: number;
  planMonth1: number;
  planMonth2: number;
  planMonth3: number;
};

export type LocationInsightsSummaryResponse = {
  totalPotential: number;
  planMonth1: number;
  planMonth2: number;
  planMonth3: number;
  overallCoveragePct: number;
  requiredCount: number;
  inStockCount: number;
  locations: LocationInsightsLocationSummary[];
  highPotentialLowCoverage: LocationInsightsLocationSummary[];
  topProblemProducts: LocationInsightsProblemProduct[];
  potentialByCategory: LocationInsightsCategoryPotential[];
};
