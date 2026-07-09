import type { ChainStatus } from "@prisma/client";

export type ChainResponse = {
  id: string;
  externalCode: string | null;
  name: string;
  status: ChainStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListChainsQuery = {
  page?: number;
  pageSize?: number;
  status?: ChainStatus;
  search?: string;
};

export type CreateChainRequestBody = {
  externalCode?: unknown;
  name?: unknown;
  notes?: unknown;
};

export type UpdateChainRequestBody = Partial<
  CreateChainRequestBody & {
    status?: unknown;
  }
>;
