import type { RouteItemStatus, RouteStatus } from "@prisma/client";

export type RouteItemResponse = {
  id: string;
  locationId: string;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  };
  sequence: number;
  status: RouteItemStatus;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  skipReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoutePlanResponse = {
  id: string;
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  planDate: string;
  status: RouteStatus;
  publishedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  items: RouteItemResponse[];
};

export type ListRoutesQuery = {
  page?: number;
  pageSize?: number;
  representativeUserId?: string;
  planDate?: string;
  status?: RouteStatus;
};

export type CreateRoutePlanRequestBody = {
  representativeUserId?: unknown;
  planDate?: unknown;
};

export type UpdateRoutePlanRequestBody = {
  status?: unknown;
  publishedAt?: unknown;
};

export type CreateRouteItemRequestBody = {
  locationId?: unknown;
  sequence?: unknown;
  plannedStartTime?: unknown;
  plannedEndTime?: unknown;
};

export type UpdateRouteItemRequestBody = Partial<
  CreateRouteItemRequestBody & {
    status?: unknown;
    skipReason?: unknown;
  }
>;
