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
  routeTemplateId: string | null;
  routeTemplate: { id: string; name: string } | null;
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

export type RouteTemplateItemResponse = {
  id: string;
  locationId: string;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  };
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type RouteTemplateResponse = {
  id: string;
  representativeUserId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: RouteTemplateItemResponse[];
};

export type ListRouteTemplatesQuery = {
  page?: number;
  pageSize?: number;
  representativeUserId?: string;
};

export type CreateRouteTemplateRequestBody = {
  representativeUserId?: unknown;
  name?: unknown;
};

export type UpdateRouteTemplateRequestBody = {
  name?: unknown;
};

export type CreateRouteTemplateItemRequestBody = {
  locationId?: unknown;
  sequence?: unknown;
};

export type UpdateRouteTemplateItemRequestBody = {
  locationId?: unknown;
  sequence?: unknown;
};

export type MoveRouteTemplateItemRequestBody = {
  direction?: unknown;
};

export type ReorderRouteTemplateItemsRequestBody = {
  itemIds?: unknown;
};

export type AssignRouteTemplateRequestBody = {
  planDate?: unknown;
};

export type CopyRouteTemplatePlansRequestBody = {
  month?: unknown;
};

export type CopyRouteTemplatePlansResponse = {
  createdCount: number;
  skippedCount: number;
};
