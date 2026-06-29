import type { VisitStatus } from "@prisma/client";

export type VisitResponse = {
  id: string;
  locationId: string;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  };
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  routeItemId: string | null;
  visitType: string;
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListVisitsQuery = {
  page?: number;
  pageSize?: number;
  representativeUserId?: string;
  locationId?: string;
  status?: VisitStatus;
};

export type CreateVisitRequestBody = {
  locationId?: unknown;
  representativeUserId?: unknown;
  routeItemId?: unknown;
  visitType?: unknown;
  startedAt?: unknown;
};

export type UpdateVisitRequestBody = {
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  cancelledAt?: unknown;
};
