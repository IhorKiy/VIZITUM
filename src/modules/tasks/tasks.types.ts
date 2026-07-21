import type { TaskStatus } from "@prisma/client";

export type TaskStatusHistoryEntry = {
  id: string;
  changedByUserId: string | null;
  changedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  oldStatus: TaskStatus | null;
  newStatus: TaskStatus;
  createdAt: string;
};

export type TaskResponse = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  isPriority: boolean;
  assignedToUserId: string | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdByUserId: string | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  locationId: string | null;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  } | null;
  visitId: string | null;
  reportId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: TaskStatusHistoryEntry[];
};

export type ListTasksQuery = {
  page?: number;
  pageSize?: number;
  assignedToUserId?: string;
  status?: TaskStatus;
  isPriority?: boolean;
  locationId?: string;
  visitId?: string;
  routePlanId?: string;
  dueFrom?: string;
  dueTo?: string;
};

export type CreateTaskRequestBody = {
  title?: unknown;
  description?: unknown;
  isPriority?: unknown;
  assignedToUserId?: unknown;
  locationId?: unknown;
  visitId?: unknown;
  reportId?: unknown;
  dueDate?: unknown;
};

export type UpdateTaskRequestBody = Partial<
  CreateTaskRequestBody & {
    status?: unknown;
    completedAt?: unknown;
  }
>;
