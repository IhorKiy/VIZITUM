import type { ProductStatus } from "@prisma/client";

export type ProductResponse = {
  id: string;
  externalCode: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  status: ProductStatus;
  notApplicable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListProductsQuery = {
  page?: number;
  pageSize?: number;
  status?: ProductStatus;
  category?: string;
  search?: string;
};

export type CreateProductRequestBody = {
  externalCode?: unknown;
  name?: unknown;
  sku?: unknown;
  category?: unknown;
  notApplicable?: unknown;
};

export type UpdateProductRequestBody = Partial<
  CreateProductRequestBody & {
    status?: unknown;
  }
>;

export type ProductCategoryResponse = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProductCategoryRequestBody = {
  name?: unknown;
};
