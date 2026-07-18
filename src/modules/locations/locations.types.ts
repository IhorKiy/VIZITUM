import type { AssignmentStatus, LocationStatus } from "@prisma/client";

export type LocationChainSummary = {
  id: string;
  name: string;
};

export type LocationCategorySummary = {
  id: string;
  name: string;
};

// Archived locations carry `deletedAt`; the enum stays active/inactive, so
// list filters and responses surface archival through a separate boolean.
export type LocationListStatus = LocationStatus | "archived";

export type LocationResponse = {
  id: string;
  externalCode: string | null;
  name: string;
  status: LocationStatus;
  archived: boolean;
  chainId: string | null;
  chain: LocationChainSummary | null;
  categoryId: string | null;
  category: LocationCategorySummary | null;
  addressLine: string;
  city: string;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  // Denormalized related records so the admin console can edit a location's
  // contacts and its active representative assignment from the same row
  // without a follow-up request per location.
  contacts: LocationContactResponse[];
  assignments: LocationAssignmentResponse[];
  createdAt: string;
  updatedAt: string;
};

export type ListLocationsQuery = {
  page?: number;
  pageSize?: number;
  status?: LocationListStatus;
  city?: string;
  territory?: string;
  chainId?: string;
  search?: string;
};

export type CreateLocationRequestBody = {
  externalCode?: unknown;
  name?: unknown;
  categoryId?: unknown;
  chainId?: unknown;
  addressLine?: unknown;
  city?: unknown;
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

export type LocationCategoryResponse = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateLocationCategoryRequestBody = {
  name?: unknown;
};

export type UpdateLocationCategoryRequestBody = {
  name?: unknown;
};
