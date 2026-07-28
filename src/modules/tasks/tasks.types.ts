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
  // When a task was finished, as YYYY-MM-DD calendar days. Only done tasks
  // carry a `completedAt`, so this filter empties an in-progress list rather
  // than narrowing it — the screens pair it with `status=done`.
  completedFrom?: string;
  completedTo?: string;
};

// The completion window a query actually ran over, after the maximum-length
// trim, echoed so a screen can name the window it is really showing rather
// than the one it asked for. Absent when the caller named no window: unlike
// visits, a task list is not windowed unless it asks to be (see
// resolveTaskCompletedRange).
export type TaskCompletedPeriodResponse = {
  completedFrom: string;
  completedTo: string | null;
};

export type ListTasksResponse = {
  items: TaskResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  completedPeriod?: TaskCompletedPeriodResponse;
  // When the earliest task in this scope was finished — the only real bottom of
  // a done list, since the clamp bounds a window's length rather than how far
  // back it points. `null` says with authority that this scope has finished
  // nothing; absent means nobody asked (an unwindowed list) and nothing may be
  // claimed from it. Those are three different answers, not two.
  completedHistoryStart?: string | null;
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
