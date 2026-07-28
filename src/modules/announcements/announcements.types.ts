export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 200;
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 2000;

// Derived from the validity window and `archivedAt` against today in the
// tenant's timezone — not a stored column, so an announcement moves from
// scheduled to active to finished on its own, with nothing to run.
export type AnnouncementState =
  "scheduled" | "active" | "finished" | "archived";

export type AnnouncementResponse = {
  id: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
  state: AnnouncementState;
  archivedAt: string | null;
  createdByUserId: string | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

// The manager's view of a published announcement: how many representatives
// have marked it read, out of how many there are to reach.
export type AnnouncementWithReadStats = AnnouncementResponse & {
  readCount: number;
  recipientCount: number;
};

// The representative's view: no read totals, only whether this caller has
// already seen it.
export type ActiveAnnouncementResponse = AnnouncementResponse & {
  isRead: boolean;
};

export type ActiveAnnouncementsResponse = {
  items: ActiveAnnouncementResponse[];
  unreadCount: number;
};

export type ListAnnouncementsQuery = {
  page?: number;
  pageSize?: number;
  state?: AnnouncementState;
};

export type CreateAnnouncementRequestBody = {
  title?: unknown;
  body?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

export type UpdateAnnouncementRequestBody =
  Partial<CreateAnnouncementRequestBody>;
