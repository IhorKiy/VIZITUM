import type { AssignmentStatus, LocationStatus } from "@prisma/client";

export type LocationResponse = {
  id: string;
  externalCode: string | null;
  name: string;
  type: string | null;
  status: LocationStatus;
  addressLine: string;
  city: string;
  region: string | null;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListLocationsQuery = {
  page?: number;
  pageSize?: number;
  status?: LocationStatus;
  city?: string;
  region?: string;
  territory?: string;
  search?: string;
};

export type CreateLocationRequestBody = {
  externalCode?: unknown;
  name?: unknown;
  type?: unknown;
  addressLine?: unknown;
  city?: unknown;
  region?: unknown;
  territory?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  notes?: unknown;
};

export type UpdateLocationRequestBody = Partial<
  CreateLocationRequestBody & {
    status?: unknown;
  }
>;

export type LocationContactResponse = {
  id: string;
  locationId: string;
  name: string;
  roleTitle: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateLocationContactRequestBody = {
  name?: unknown;
  roleTitle?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
};

export type UpdateLocationContactRequestBody =
  Partial<CreateLocationContactRequestBody>;

export type LocationAssignmentResponse = {
  id: string;
  locationId: string;
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  status: AssignmentStatus;
  assignedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateLocationAssignmentRequestBody = {
  representativeUserId?: unknown;
};
