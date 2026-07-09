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
import type {
  CreateLocationAssignmentRequestBody,
  CreateLocationContactRequestBody,
  CreateLocationRequestBody,
  ListLocationsQuery,
  LocationAssignmentResponse,
  LocationContactResponse,
  LocationResponse,
  UpdateLocationContactRequestBody,
  UpdateLocationRequestBody,
} from "./locations.types";

// Every location read that feeds toLocationResponse loads the linked chain
// (id + name only) so the response can expose the denormalized chain summary.
const LOCATION_INCLUDE = {
  chain: { select: { id: true, name: true } },
} satisfies Prisma.LocationInclude;

type LocationWithChain = Prisma.LocationGetPayload<{
  include: typeof LOCATION_INCLUDE;
}>;

type LocationCreateData = {
  externalCode: string | null;
  name: string;
  type: string | null;
  chainId: string | null;
  addressLine: string;
  city: string;
  region: string | null;
  territory: string | null;
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
    const location = await this.findTenantLocation(
      context.tenantId,
      locationId,
    );

    return toLocationResponse(location);
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

    const updatedLocation = await this.prisma.location.update({
      where: { id: location.id },
      data,
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
  return {
    tenantId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.city ? { city: query.city } : {}),
    ...(query.region ? { region: query.region } : {}),
    ...(query.territory ? { territory: query.territory } : {}),
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
    type: normalizeOptionalString(body.type),
    chainId: normalizeId(body.chainId),
    region: normalizeOptionalString(body.region),
    territory: normalizeOptionalString(body.territory),
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
    ...(body.type !== undefined
      ? { type: normalizeOptionalString(body.type) }
      : {}),
    ...(body.chainId !== undefined
      ? { chainId: normalizeId(body.chainId) }
      : {}),
    ...(body.region !== undefined
      ? { region: normalizeOptionalString(body.region) }
      : {}),
    ...(body.territory !== undefined
      ? { territory: normalizeOptionalString(body.territory) }
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

function normalizeLocationStatus(value: unknown): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

function toLocationResponse(location: LocationWithChain): LocationResponse {
  return {
    id: location.id,
    externalCode: location.externalCode,
    name: location.name,
    type: location.type,
    status: location.status,
    chainId: location.chainId,
    chain: location.chain
      ? { id: location.chain.id, name: location.chain.name }
      : null,
    addressLine: location.addressLine,
    city: location.city,
    region: location.region,
    territory: location.territory,
    latitude: location.latitude?.toNumber() ?? null,
    longitude: location.longitude?.toNumber() ?? null,
    notes: location.notes,
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
