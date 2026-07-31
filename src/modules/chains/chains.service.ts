import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Chain, ChainStatus, Prisma } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import {
  assertTextWithinLimit,
  type TextLimitKey,
} from "../../common/input-limits";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  ChainResponse,
  CreateChainRequestBody,
  ListChainsQuery,
  UpdateChainRequestBody,
} from "./chains.types";

type ChainCreateData = {
  externalCode: string | null;
  name: string;
  notes: string | null;
};

type ChainUpdateData = Partial<
  ChainCreateData & {
    status: ChainStatus;
  }
>;

@Injectable()
export class ChainsService {
  constructor(private readonly prisma: PrismaService) {}

  async listChains(
    context: RequestContext,
    query: ListChainsQuery,
  ): Promise<PaginatedResponse<ChainResponse>> {
    const pagination = resolvePagination(query);
    const where = buildChainWhere(context.tenantId, query);
    const [chains, total] = await Promise.all([
      this.prisma.chain.findMany({
        where,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.chain.count({ where }),
    ]);

    return createPaginatedResponse(
      chains.map(toChainResponse),
      pagination,
      total,
    );
  }

  async getChain(
    context: RequestContext,
    chainId: string,
  ): Promise<ChainResponse> {
    const chain = await this.findTenantChain(context.tenantId, chainId);

    return toChainResponse(chain);
  }

  async createChain(
    context: RequestContext,
    body: CreateChainRequestBody,
  ): Promise<ChainResponse> {
    const data = parseCreateChainBody(body);

    await this.assertNameAvailable(context.tenantId, data.name);

    if (data.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
      );
    }

    const chain = await this.prisma.chain.create({
      data: {
        tenantId: context.tenantId,
        ...data,
      },
    });

    return toChainResponse(chain);
  }

  async updateChain(
    context: RequestContext,
    chainId: string,
    body: UpdateChainRequestBody,
  ): Promise<ChainResponse> {
    const chain = await this.findTenantChain(context.tenantId, chainId);
    const data = parseUpdateChainBody(body);

    if (data.name && data.name !== chain.name) {
      await this.assertNameAvailable(context.tenantId, data.name, chain.id);
    }

    if (data.externalCode && data.externalCode !== chain.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
        chain.id,
      );
    }

    const updatedChain = await this.prisma.chain.update({
      where: { id: chain.id },
      data,
    });

    return toChainResponse(updatedChain);
  }

  private async findTenantChain(
    tenantId: string,
    chainId: string,
  ): Promise<Chain> {
    const chain = await this.prisma.chain.findFirst({
      where: {
        id: chainId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!chain) {
      throw new NotFoundException({
        code: "CHAIN_NOT_FOUND",
        message: "Chain was not found.",
      });
    }

    return chain;
  }

  private async assertNameAvailable(
    tenantId: string,
    name: string,
    ignoredChainId?: string,
  ): Promise<void> {
    const existingChain = await this.prisma.chain.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: "insensitive" },
        deletedAt: null,
        ...(ignoredChainId ? { id: { not: ignoredChainId } } : {}),
      },
      select: { id: true },
    });

    if (existingChain) {
      throw new ConflictException({
        code: "CHAIN_NAME_EXISTS",
        message: "Chain name is already in use.",
        fieldErrors: {
          name: ["Name is already in use."],
        },
      });
    }
  }

  private async assertExternalCodeAvailable(
    tenantId: string,
    externalCode: string,
    ignoredChainId?: string,
  ): Promise<void> {
    const existingChain = await this.prisma.chain.findFirst({
      where: {
        tenantId,
        externalCode,
        deletedAt: null,
        ...(ignoredChainId ? { id: { not: ignoredChainId } } : {}),
      },
      select: { id: true },
    });

    if (existingChain) {
      throw new ConflictException({
        code: "CHAIN_EXTERNAL_CODE_EXISTS",
        message: "Chain external code is already in use.",
        fieldErrors: {
          externalCode: ["External code is already in use."],
        },
      });
    }
  }
}

function buildChainWhere(
  tenantId: string,
  query: ListChainsQuery,
): Prisma.ChainWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { externalCode: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function parseCreateChainBody(body: CreateChainRequestBody): ChainCreateData {
  const name = normalizeRequiredString(body.name, "name", "name");

  if (!name) {
    throw new BadRequestException({
      code: "CHAIN_INVALID",
      message: "Chain name is required.",
      fieldErrors: {
        name: ["Name is required."],
      },
    });
  }

  return {
    name,
    externalCode: normalizeOptionalString(
      body.externalCode,
      "code",
      "externalCode",
    ),
    notes: normalizeOptionalString(body.notes, "notes", "notes"),
  };
}

function parseUpdateChainBody(body: UpdateChainRequestBody): ChainUpdateData {
  const status = normalizeChainStatus(body.status);

  return {
    ...(body.name !== undefined
      ? { name: normalizeRequiredPatchString(body.name, "name", "name") }
      : {}),
    ...(body.externalCode !== undefined
      ? {
          externalCode: normalizeOptionalString(
            body.externalCode,
            "code",
            "externalCode",
          ),
        }
      : {}),
    ...(body.notes !== undefined
      ? { notes: normalizeOptionalString(body.notes, "notes", "notes") }
      : {}),
    ...(status ? { status } : {}),
  };
}

// Every free-text normalizer takes the cap its column should honour. The
// columns are unbounded `text`, and the web app's own maxLength is a courtesy
// to the person typing, not a control — the endpoint is reachable with curl.
// The keys mirror apps/web/lib/input-limits.ts; keep the two in sync.
function normalizeRequiredString(
  value: unknown,
  limit: TextLimitKey,
  field: string,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  return assertTextWithinLimit(normalizedValue, limit, field, "CHAIN_INVALID");
}

function normalizeRequiredPatchString(
  value: unknown,
  field: string,
  limit: TextLimitKey,
): string {
  const normalizedValue = normalizeRequiredString(value, limit, field);

  if (!normalizedValue) {
    throw new BadRequestException({
      code: "CHAIN_INVALID",
      message: "Chain field is invalid.",
      fieldErrors: {
        [field]: ["Value cannot be empty."],
      },
    });
  }

  return normalizedValue;
}

function normalizeOptionalString(
  value: unknown,
  limit: TextLimitKey,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  return assertTextWithinLimit(normalizedValue, limit, field, "CHAIN_INVALID");
}

function normalizeChainStatus(value: unknown): ChainStatus | null {
  if (value === "active" || value === "archived") {
    return value;
  }

  return null;
}

function toChainResponse(chain: Chain): ChainResponse {
  return {
    id: chain.id,
    externalCode: chain.externalCode,
    name: chain.name,
    status: chain.status,
    notes: chain.notes,
    createdAt: chain.createdAt.toISOString(),
    updatedAt: chain.updatedAt.toISOString(),
  };
}
