import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Location, LocationStatus, Prisma } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateLocationRequestBody,
  ListLocationsQuery,
  LocationResponse,
  UpdateLocationRequestBody,
} from "./locations.types";

type LocationCreateData = {
  externalCode: string | null;
  name: string;
  type: string | null;
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

    const location = await this.prisma.location.create({
      data: {
        tenantId: context.tenantId,
        ...data,
      },
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

    const updatedLocation = await this.prisma.location.update({
      where: { id: location.id },
      data,
    });

    return toLocationResponse(updatedLocation);
  }

  private async findTenantLocation(
    tenantId: string,
    locationId: string,
  ): Promise<Location> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!location) {
      throw new NotFoundException({
        code: "LOCATION_NOT_FOUND",
        message: "Location was not found.",
      });
    }

    return location;
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
    region: normalizeOptionalString(body.region),
    territory: normalizeOptionalString(body.territory),
    latitude: normalizeCoordinate(body.latitude),
    longitude: normalizeCoordinate(body.longitude),
    notes: normalizeOptionalString(body.notes),
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

function toLocationResponse(location: Location): LocationResponse {
  return {
    id: location.id,
    externalCode: location.externalCode,
    name: location.name,
    type: location.type,
    status: location.status,
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
