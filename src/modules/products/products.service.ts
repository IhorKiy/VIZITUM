import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Product, ProductStatus } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateProductRequestBody,
  ListProductsQuery,
  ProductResponse,
  UpdateProductRequestBody,
} from "./products.types";

type ProductCreateData = {
  externalCode: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  notApplicable: boolean;
};

type ProductUpdateData = Partial<
  ProductCreateData & {
    status: ProductStatus;
  }
>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(
    context: RequestContext,
    query: ListProductsQuery,
  ): Promise<PaginatedResponse<ProductResponse>> {
    const pagination = resolvePagination(query);
    const where = buildProductWhere(context.tenantId, query);
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return createPaginatedResponse(
      products.map(toProductResponse),
      pagination,
      total,
    );
  }

  async getProduct(
    context: RequestContext,
    productId: string,
  ): Promise<ProductResponse> {
    const product = await this.findTenantProduct(context.tenantId, productId);

    return toProductResponse(product);
  }

  async createProduct(
    context: RequestContext,
    body: CreateProductRequestBody,
  ): Promise<ProductResponse> {
    const data = parseCreateProductBody(body);

    if (data.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
      );
    }

    const product = await this.prisma.product.create({
      data: {
        tenantId: context.tenantId,
        ...data,
      },
    });

    return toProductResponse(product);
  }

  async updateProduct(
    context: RequestContext,
    productId: string,
    body: UpdateProductRequestBody,
  ): Promise<ProductResponse> {
    const product = await this.findTenantProduct(context.tenantId, productId);
    const data = parseUpdateProductBody(body);

    if (data.externalCode && data.externalCode !== product.externalCode) {
      await this.assertExternalCodeAvailable(
        context.tenantId,
        data.externalCode,
        product.id,
      );
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id: product.id },
      data,
    });

    return toProductResponse(updatedProduct);
  }

  private async findTenantProduct(
    tenantId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!product) {
      throw new NotFoundException({
        code: "PRODUCT_NOT_FOUND",
        message: "Product was not found.",
      });
    }

    return product;
  }

  private async assertExternalCodeAvailable(
    tenantId: string,
    externalCode: string,
    ignoredProductId?: string,
  ): Promise<void> {
    const existingProduct = await this.prisma.product.findFirst({
      where: {
        tenantId,
        externalCode,
        deletedAt: null,
        ...(ignoredProductId ? { id: { not: ignoredProductId } } : {}),
      },
      select: { id: true },
    });

    if (existingProduct) {
      throw new ConflictException({
        code: "PRODUCT_EXTERNAL_CODE_EXISTS",
        message: "Product external code is already in use.",
        fieldErrors: {
          externalCode: ["External code is already in use."],
        },
      });
    }
  }
}

function buildProductWhere(
  tenantId: string,
  query: ListProductsQuery,
): Prisma.ProductWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { sku: { contains: query.search, mode: "insensitive" } },
            { externalCode: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function parseCreateProductBody(
  body: CreateProductRequestBody,
): ProductCreateData {
  const name = normalizeRequiredString(body.name);

  if (!name) {
    throw new BadRequestException({
      code: "PRODUCT_INVALID",
      message: "Product name is required.",
      fieldErrors: {
        name: ["Name is required."],
      },
    });
  }

  return {
    name,
    externalCode: normalizeOptionalString(body.externalCode),
    sku: normalizeOptionalString(body.sku),
    category: normalizeOptionalString(body.category),
    notApplicable: normalizeBoolean(body.notApplicable, false),
  };
}

function parseUpdateProductBody(
  body: UpdateProductRequestBody,
): ProductUpdateData {
  const status = normalizeProductStatus(body.status);

  return {
    ...(body.name !== undefined
      ? { name: normalizeRequiredPatchString(body.name, "name") }
      : {}),
    ...(body.externalCode !== undefined
      ? { externalCode: normalizeOptionalString(body.externalCode) }
      : {}),
    ...(body.sku !== undefined
      ? { sku: normalizeOptionalString(body.sku) }
      : {}),
    ...(body.category !== undefined
      ? { category: normalizeOptionalString(body.category) }
      : {}),
    ...(body.notApplicable !== undefined
      ? { notApplicable: normalizeBoolean(body.notApplicable, false) }
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
      code: "PRODUCT_INVALID",
      message: "Product field is invalid.",
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

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function normalizeProductStatus(value: unknown): ProductStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

function toProductResponse(product: Product): ProductResponse {
  return {
    id: product.id,
    externalCode: product.externalCode,
    name: product.name,
    sku: product.sku,
    category: product.category,
    status: product.status,
    notApplicable: product.notApplicable,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
