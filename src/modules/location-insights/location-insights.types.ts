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
  // Required rows a visit has actually confirmed. Without it `coveragePct: 0`
  // reads the same whether nobody has visited yet or the shelf was empty, and
  // those two call for opposite actions.
  checkedCount: number;
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
  checkedCount: number;
  // Most recent shelf check across this location's required rows, or null if
  // no visit has confirmed one yet. Reported as a date so the manager can see
  // how old the coverage number is; no staleness threshold is applied here.
  lastCheckedAt: string | null;
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
  checkedCount: number;
  locations: LocationInsightsLocationSummary[];
  highPotentialLowCoverage: LocationInsightsLocationSummary[];
  // High-potential locations no visit has ever checked. Kept apart from
  // `highPotentialLowCoverage` on purpose: an unchecked location is a visit
  // problem, and listing it as under-covered would send a manager to fix an
  // assortment that nobody has looked at yet.
  neverChecked: LocationInsightsLocationSummary[];
  topProblemProducts: LocationInsightsProblemProduct[];
  potentialByCategory: LocationInsightsCategoryPotential[];
};
