import type { TaskPriority, TaskStatus } from "@prisma/client";

export type TaskResponse = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToUserId: string | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdByUserId: string | null;
  locationId: string | null;
  visitId: string | null;
  reportId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListTasksQuery = {
  page?: number;
  pageSize?: number;
  assignedToUserId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  locationId?: string;
  visitId?: string;
};

export type CreateTaskRequestBody = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
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
