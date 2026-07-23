import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { LocationStatus, Prisma } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  assertCanManageContacts,
  assertCanManageLocationNotes,
  canManageLocationHeader,
} from "./locations-write-access";
import type {
  CreateLocationAssignmentRequestBody,
  CreateLocationContactRequestBody,
  CreateLocationRequestBody,
  ListLocationsQuery,
  LocationAssignmentResponse,
  LocationContactResponse,
  LocationResponse,
  UpdateLocationContactRequestBody,
  UpdateLocationNotesRequestBody,
  UpdateLocationRequestBody,
} from "./locations.types";

// A location holds at most this many contacts. The field-zone UI hides the add
// affordance once two exist; this server-side cap is the authoritative guard
// (mirrors the admin console's fixed two-slot contact form).
const MAX_LOCATION_CONTACTS = 2;

// Every location read that feeds toLocationResponse loads the linked chain
// (id + name only) plus the location's live contacts and active assignments so
// the response can expose the denormalized chain summary alongside the related
// records the admin console edits inline. Contacts are ordered oldest-first so
// the "primary"/"secondary" slots stay stable across edits.
const LOCATION_INCLUDE = {
  chain: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  contacts: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
  },
  assignments: {
    where: { status: "active" },
    include: { representative: true },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.LocationInclude;

type LocationWithChain = Prisma.LocationGetPayload<{
  include: typeof LOCATION_INCLUDE;
}>;

type LocationCreateData = {
  externalCode: string | null;
  name: string;
  categoryId: string | null;
  chainId: string | null;
  addressLine: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

type LocationUpdateData = Partial<
  LocationCreateData & {
    status: LocationStatus;
  }
>;

type LocationContactData = {
  name: string;
  roleTitle: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

type LocationContactUpdateData = Partial<LocationContactData>;

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listLocations(
    context: RequestContext,
    query: ListLocationsQuery,
  ): Promise<PaginatedResponse<LocationResponse>> {
    const pagination = resolvePagination(query);
    const where = buildLocationWhere(context.tenantId, query);

    const [locations, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        include: LOCATION_INCLUDE,
      }),
      this.prisma.location.count({ where }),
    ]);

    return createPaginatedResponse(
      locations.map(toLocationResponse),
      pagination,
      total,
    );
  }

  async getLocation(
    context: RequestContext,
    locationId: string,
  ): Promise<LocationResponse> {
    const location = await this.findTenantLocationIncludingArchived(
      context.tenantId,
      locationId,
    );
    const { canManageNotes, canManageContacts } = await canManageLocationHeader(
      context,
      this.prisma,
      locationId,
    );

    return {
      ...toLocationResponse(location),
      canManageNotes,
      canManageContacts,
    };
  }

  async createLocation(
    context: RequestContext,
    body: CreateLocationRequestBody,
  ): Promise<LocationResponse> {
    const data = parseCreateLocationBody(body);

    if (data.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
      );
    }

    await this.assertChainAvailable(context.tenantId, data.chainId);
    await this.assertCategoryAvailable(context.tenantId, data.categoryId);

    const location = await this.prisma.location.create({
      data: {
        tenantId: context.tenantId,
        ...data,
      },
      include: LOCATION_INCLUDE,
    });

    return toLocationResponse(location);
  }

  async updateLocation(
    context: RequestContext,
    locationId: string,
    body: UpdateLocationRequestBody,
  ): Promise<LocationResponse> {
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );
    const data = parseUpdateLocationBody(body);

    if (data.externalCode && data.externalCode !== location.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
        location.id,
      );
    }

    if (data.chainId !== undefined) {
      await this.assertChainAvailable(context.tenantId, data.chainId);
    }

    if (data.categoryId !== undefined) {
      await this.assertCategoryAvailable(context.tenantId, data.categoryId);
    }

    const updatedLocation = await this.prisma.location.update({
      where: { id: location.id },
      data,
      include: LOCATION_INCLUDE,
    });

    return toLocationResponse(updatedLocation);
  }

  // Soft-archive: the row keeps all its history (visits, tasks, reports) and
  // drops out of the default lists, so nothing referencing it is orphaned.
  async archiveLocation(
    context: RequestContext,
    locationId: string,
  ): Promise<LocationResponse> {
    // Existence guard only — the full row is hydrated once, by the update.
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException({
        code: "LOCATION_NOT_FOUND",
        message: "Location was not found.",
      });
    }

    const archivedLocation = await this.prisma.location.update({
      where: { id: location.id },
      data: { deletedAt: new Date() },
      include: LOCATION_INCLUDE,
    });

    return toLocationResponse(archivedLocation);
  }

  async restoreLocation(
    context: RequestContext,
    locationId: string,
  ): Promise<LocationResponse> {
    // Existence guard only — the full row is hydrated once, by the update.
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId: context.tenantId,
        deletedAt: { not: null },
      },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException({
        code: "LOCATION_NOT_FOUND",
        message: "Archived location was not found.",
      });
    }

    const restoredLocation = await this.prisma.location.update({
      where: { id: location.id },
      data: { deletedAt: null },
      include: LOCATION_INCLUDE,
    });

    return toLocationResponse(restoredLocation);
  }

  async updateLocationNotes(
    context: RequestContext,
    locationId: string,
    body: UpdateLocationNotesRequestBody,
  ): Promise<LocationResponse> {
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );
    await assertCanManageLocationNotes(context, this.prisma, locationId);

    const updatedLocation = await this.prisma.location.update({
      where: { id: location.id },
      data: { notes: normalizeNotesInput(body.notes) },
      include: LOCATION_INCLUDE,
    });

    return toLocationResponse(updatedLocation);
  }

  async listContacts(
    context: RequestContext,
    locationId: string,
  ): Promise<LocationContactResponse[]> {
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );
    const contacts = await this.prisma.locationContact.findMany({
      where: {
        tenantId: context.tenantId,
        locationId: location.id,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    return contacts.map(toLocationContactResponse);
  }

  async createContact(
    context: RequestContext,
    locationId: string,
    body: CreateLocationContactRequestBody,
  ): Promise<LocationContactResponse> {
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );
    await assertCanManageContacts(context, this.prisma, locationId);

    const activeContacts = await this.prisma.locationContact.count({
      where: {
        tenantId: context.tenantId,
        locationId: location.id,
        deletedAt: null,
      },
    });
    if (activeContacts >= MAX_LOCATION_CONTACTS) {
      throw new ConflictException({
        code: "LOCATION_CONTACT_LIMIT_REACHED",
        message: `A location can have at most ${MAX_LOCATION_CONTACTS} contacts.`,
      });
    }

    const data = parseCreateContactBody(body);
    const contact = await this.prisma.locationContact.create({
      data: {
        tenantId: context.tenantId,
        locationId: location.id,
        ...data,
      },
    });

    return toLocationContactResponse(contact);
  }

  async updateContact(
    context: RequestContext,
    locationId: string,
    contactId: string,
    body: UpdateLocationContactRequestBody,
  ): Promise<LocationContactResponse> {
    const contact = await this.findTenantContact(
      context.tenantId,
      locationId,
      contactId,
    );
    await assertCanManageContacts(context, this.prisma, locationId);
    const data = parseUpdateContactBody(body);
    const updatedContact = await this.prisma.locationContact.update({
      where: { id: contact.id },
      data,
    });

    return toLocationContactResponse(updatedContact);
  }

  async deleteContact(
    context: RequestContext,
    locationId: string,
    contactId: string,
  ): Promise<{ ok: true }> {
    const contact = await this.findTenantContact(
      context.tenantId,
      locationId,
      contactId,
    );
    await assertCanManageContacts(context, this.prisma, locationId);

    await this.prisma.locationContact.update({
      where: { id: contact.id },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async listAssignments(
    context: RequestContext,
    locationId: string,
  ): Promise<LocationAssignmentResponse[]> {
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );
    const assignments = await this.prisma.locationAssignment.findMany({
      where: {
        tenantId: context.tenantId,
        locationId: location.id,
      },
      include: {
        representative: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return assignments.map(toLocationAssignmentResponse);
  }

  async createAssignment(
    context: RequestContext,
    locationId: string,
    body: CreateLocationAssignmentRequestBody,
  ): Promise<LocationAssignmentResponse> {
    const representativeUserId = normalizeId(body.representativeUserId);

    if (!representativeUserId) {
      throw new BadRequestException({
        code: "LOCATION_ASSIGNMENT_INVALID",
        message: "Representative user id is required.",
        fieldErrors: {
          representativeUserId: ["Representative user id is required."],
        },
      });
    }

    const [location, representative] = await Promise.all([
      this.findTenantLocation(context.tenantId, locationId),
      this.findTenantFieldRepresentative(
        context.tenantId,
        representativeUserId,
      ),
    ]);

    const assignment = await this.prisma.locationAssignment.upsert({
      where: {
        tenantId_locationId_representativeUserId: {
          tenantId: context.tenantId,
          locationId: location.id,
          representativeUserId: representative.id,
        },
      },
      create: {
        tenantId: context.tenantId,
        locationId: location.id,
        representativeUserId: representative.id,
        assignedByUserId: context.userId,
        status: "active",
      },
      update: {
        assignedByUserId: context.userId,
        status: "active",
      },
      include: {
        representative: true,
      },
    });

    return toLocationAssignmentResponse(assignment);
  }

  async deactivateAssignment(
    context: RequestContext,
    locationId: string,
    assignmentId: string,
  ): Promise<LocationAssignmentResponse> {
    const assignment = await this.findTenantAssignment(
      context.tenantId,
      locationId,
      assignmentId,
    );
    const updatedAssignment = await this.prisma.locationAssignment.update({
      where: { id: assignment.id },
      data: { status: "inactive" },
      include: {
        representative: true,
      },
    });

    return toLocationAssignmentResponse(updatedAssignment);
  }

  private async findTenantLocation(
    tenantId: string,
    locationId: string,
  ): Promise<LocationWithChain> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        deletedAt: null,
      },
      include: LOCATION_INCLUDE,
    });

    if (!location) {
      throw new NotFoundException({
        code: "LOCATION_NOT_FOUND",
        message: "Location was not found.",
      });
    }

    return location;
  }

  // Unlike findTenantLocation, intentionally omits the deletedAt filter.
  // GET /locations/:id is the one place an archived location must still be
  // readable — the location detail screens show a restore-first notice over
  // the potential/assortment sections instead of 404ing the whole page — so
  // only getLocation uses this. Every write and every other lookup
  // (contacts, assignments, potential, assortment, ...) keeps rejecting
  // archived rows via findTenantLocation / findTenantLocationOrThrow.
  private async findTenantLocationIncludingArchived(
    tenantId: string,
    locationId: string,
  ): Promise<LocationWithChain> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
      },
      include: LOCATION_INCLUDE,
    });

    if (!location) {
      throw new NotFoundException({
        code: "LOCATION_NOT_FOUND",
        message: "Location was not found.",
      });
    }

    return location;
  }

  // A location may only be linked to a chain owned by the same tenant. `null`
  // clears the link and is always allowed.
  private async assertChainAvailable(
    tenantId: string,
    chainId: string | null,
  ): Promise<void> {
    if (!chainId) {
      return;
    }

    const chain = await this.prisma.chain.findFirst({
      where: {
        id: chainId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!chain) {
      throw new BadRequestException({
        code: "LOCATION_CHAIN_INVALID",
        message: "Chain was not found for this tenant.",
        fieldErrors: {
          chainId: ["Chain was not found."],
        },
      });
    }
  }

  // A location may only reference a category owned by the same tenant —
  // never trust a categoryId from the request body against another tenant's
  // dictionary. `null` clears the category and is always allowed.
  private async assertCategoryAvailable(
    tenantId: string,
    categoryId: string | null,
  ): Promise<void> {
    if (!categoryId) {
      return;
    }

    const category = await this.prisma.locationCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
      },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException({
        code: "LOCATION_CATEGORY_INVALID",
        message: "Category was not found for this tenant.",
        fieldErrors: {
          categoryId: ["Category was not found."],
        },
      });
    }
  }

  private async assertExternalCodeAvailable(
    tenantId: string,
    externalCode: string,
    ignoredLocationId?: string,
  ): Promise<void> {
    const existingLocation = await this.prisma.location.findFirst({
      where: {
        tenantId,
        externalCode,
        deletedAt: null,
        ...(ignoredLocationId ? { id: { not: ignoredLocationId } } : {}),
      },
      select: { id: true },
    });

    if (existingLocation) {
      throw new ConflictException({
        code: "LOCATION_EXTERNAL_CODE_EXISTS",
        message: "Location external code is already in use.",
        fieldErrors: {
          externalCode: ["External code is already in use."],
        },
      });
    }
  }

  private async findTenantContact(
    tenantId: string,
    locationId: string,
    contactId: string,
  ) {
    await this.findTenantLocation(tenantId, locationId);

    const contact = await this.prisma.locationContact.findFirst({
      where: {
        id: contactId,
        tenantId,
        locationId,
        deletedAt: null,
      },
    });

    if (!contact) {
      throw new NotFoundException({
        code: "LOCATION_CONTACT_NOT_FOUND",
        message: "Location contact was not found.",
      });
    }

    return contact;
  }

  private async findTenantFieldRepresentative(
    tenantId: string,
    userId: string,
  ) {
    const representative = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        status: "active",
        roles: {
          some: {
            tenantId,
            roleCode: "field_representative",
          },
        },
      },
    });

    if (!representative) {
      throw new BadRequestException({
        code: "REPRESENTATIVE_INVALID",
        message: "Representative must be an active field representative.",
        fieldErrors: {
          representativeUserId: [
            "Representative must be an active field representative.",
          ],
        },
      });
    }

    return representative;
  }

  private async findTenantAssignment(
    tenantId: string,
    locationId: string,
    assignmentId: string,
  ) {
    await this.findTenantLocation(tenantId, locationId);

    const assignment = await this.prisma.locationAssignment.findFirst({
      where: {
        id: assignmentId,
        tenantId,
        locationId,
      },
      include: {
        representative: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException({
        code: "LOCATION_ASSIGNMENT_NOT_FOUND",
        message: "Location assignment was not found.",
      });
    }

    return assignment;
  }
}

function buildLocationWhere(
  tenantId: string,
  query: ListLocationsQuery,
): Prisma.LocationWhereInput {
  // `archived` is not a real status — it means the row is soft-deleted. Every
  // other filter runs against live rows only.
  return {
    tenantId,
    ...(query.status === "archived"
      ? { deletedAt: { not: null } }
      : { deletedAt: null, ...(query.status ? { status: query.status } : {}) }),
    ...(query.city ? { city: query.city } : {}),
    ...(query.chainId ? { chainId: query.chainId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { externalCode: { contains: query.search, mode: "insensitive" } },
            { addressLine: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function parseCreateLocationBody(
  body: CreateLocationRequestBody,
): LocationCreateData {
  const name = normalizeRequiredString(body.name);
  const addressLine = normalizeRequiredString(body.addressLine);
  const city = normalizeRequiredString(body.city);

  if (!name || !addressLine || !city) {
    throw new BadRequestException({
      code: "LOCATION_INVALID",
      message: "Location name, address line and city are required.",
      fieldErrors: {
        name: name ? [] : ["Name is required."],
        addressLine: addressLine ? [] : ["Address line is required."],
        city: city ? [] : ["City is required."],
      },
    });
  }

  return {
    name,
    addressLine,
    city,
    externalCode: normalizeOptionalString(body.externalCode),
    categoryId: normalizeId(body.categoryId),
    chainId: normalizeId(body.chainId),
    latitude: normalizeCoordinate(body.latitude),
    longitude: normalizeCoordinate(body.longitude),
    notes: normalizeOptionalString(body.notes),
  };
}

function parseCreateContactBody(
  body: CreateLocationContactRequestBody,
): LocationContactData {
  const name = normalizeRequiredString(body.name);

  if (!name) {
    throw new BadRequestException({
      code: "LOCATION_CONTACT_INVALID",
      message: "Contact name is required.",
      fieldErrors: {
        name: ["Name is required."],
      },
    });
  }

  return {
    name,
    roleTitle: normalizeOptionalString(body.roleTitle),
    phone: normalizeOptionalString(body.phone),
    email: normalizeOptionalString(body.email),
    notes: normalizeOptionalString(body.notes),
  };
}

function parseUpdateContactBody(
  body: UpdateLocationContactRequestBody,
): LocationContactUpdateData {
  return {
    ...(body.name !== undefined
      ? { name: normalizeRequiredPatchString(body.name, "name") }
      : {}),
    ...(body.roleTitle !== undefined
      ? { roleTitle: normalizeOptionalString(body.roleTitle) }
      : {}),
    ...(body.phone !== undefined
      ? { phone: normalizeOptionalString(body.phone) }
      : {}),
    ...(body.email !== undefined
      ? { email: normalizeOptionalString(body.email) }
      : {}),
    ...(body.notes !== undefined
      ? { notes: normalizeOptionalString(body.notes) }
      : {}),
  };
}

function parseUpdateLocationBody(
  body: UpdateLocationRequestBody,
): LocationUpdateData {
  const status = normalizeLocationStatus(body.status);

  return {
    ...(body.name !== undefined
      ? { name: normalizeRequiredPatchString(body.name, "name") }
      : {}),
    ...(body.addressLine !== undefined
      ? {
          addressLine: normalizeRequiredPatchString(
            body.addressLine,
            "addressLine",
          ),
        }
      : {}),
    ...(body.city !== undefined
      ? { city: normalizeRequiredPatchString(body.city, "city") }
      : {}),
    ...(body.externalCode !== undefined
      ? { externalCode: normalizeOptionalString(body.externalCode) }
      : {}),
    ...(body.categoryId !== undefined
      ? { categoryId: normalizeId(body.categoryId) }
      : {}),
    ...(body.chainId !== undefined
      ? { chainId: normalizeId(body.chainId) }
      : {}),
    ...(body.latitude !== undefined
      ? { latitude: normalizeCoordinate(body.latitude) }
      : {}),
    ...(body.longitude !== undefined
      ? { longitude: normalizeCoordinate(body.longitude) }
      : {}),
    ...(body.notes !== undefined
      ? { notes: normalizeOptionalString(body.notes) }
      : {}),
    ...(status ? { status } : {}),
  };
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeRequiredPatchString(value: unknown, field: string): string {
  const normalizedValue = normalizeRequiredString(value);

  if (!normalizedValue) {
    throw new BadRequestException({
      code: "LOCATION_INVALID",
      message: "Location field is invalid.",
      fieldErrors: {
        [field]: ["Value cannot be empty."],
      },
    });
  }

  return normalizedValue;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

// Stricter than normalizeOptionalString for the dedicated notes endpoint:
// missing/null/blank clears the note, a string is stored trimmed, and any
// other type is rejected rather than silently coerced to "clear the note".
function normalizeNotesInput(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "LOCATION_NOTES_INVALID",
      message: "Location note must be a string.",
    });
  }

  return value.trim() || null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeCoordinate(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    throw new BadRequestException({
      code: "LOCATION_COORDINATE_INVALID",
      message: "Location coordinate is invalid.",
    });
  }

  const coordinate =
    typeof value === "number" ? value : Number.parseFloat(value);

  if (!Number.isFinite(coordinate)) {
    throw new BadRequestException({
      code: "LOCATION_COORDINATE_INVALID",
      message: "Location coordinate is invalid.",
    });
  }

  return coordinate;
}

// Only active/inactive are writable. Archiving is a dedicated action
// (`archiveLocation`); `archived` is never accepted as a status on a write.
function normalizeLocationStatus(value: unknown): LocationStatus | null {
  if (value === "active" || value === "inactive") {
    return value;
  }

  return null;
}

function toLocationResponse(location: LocationWithChain): LocationResponse {
  return {
    id: location.id,
    externalCode: location.externalCode,
    name: location.name,
    status: location.status,
    archived: location.deletedAt !== null,
    chainId: location.chainId,
    chain: location.chain
      ? { id: location.chain.id, name: location.chain.name }
      : null,
    categoryId: location.categoryId,
    category: location.category
      ? { id: location.category.id, name: location.category.name }
      : null,
    addressLine: location.addressLine,
    city: location.city,
    latitude: location.latitude?.toNumber() ?? null,
    longitude: location.longitude?.toNumber() ?? null,
    notes: location.notes,
    contacts: location.contacts.map(toLocationContactResponse),
    assignments: location.assignments.map(toLocationAssignmentResponse),
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function toLocationContactResponse(contact: {
  id: string;
  locationId: string;
  name: string;
  roleTitle: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LocationContactResponse {
  return {
    id: contact.id,
    locationId: contact.locationId,
    name: contact.name,
    roleTitle: contact.roleTitle,
    phone: contact.phone,
    email: contact.email,
    notes: contact.notes,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

function toLocationAssignmentResponse(assignment: {
  id: string;
  locationId: string;
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  status: "active" | "inactive";
  assignedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LocationAssignmentResponse {
  return {
    id: assignment.id,
    locationId: assignment.locationId,
    representativeUserId: assignment.representativeUserId,
    representative: {
      id: assignment.representative.id,
      email: assignment.representative.email,
      name: assignment.representative.name,
    },
    status: assignment.status,
    assignedByUserId: assignment.assignedByUserId,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}
