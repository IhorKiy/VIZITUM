import type { NoOrderReason } from "./api-client";
import { isNoOrderReason } from "./visit-result";

// The shape of an unconfirmed field report as it is held on the device, split
// out from the form component so the plumbing that stores it stays generic and
// this part — which is the only part that can be got wrong silently — is
// testable without a browser.

export type ProblemType = "return" | "damaged" | "expired" | "conflict";

export const PROBLEM_TYPES: ProblemType[] = [
  "return",
  "damaged",
  "expired",
  "conflict",
];

export function isProblemType(value: unknown): value is ProblemType {
  return (
    typeof value === "string" &&
    (PROBLEM_TYPES as readonly string[]).includes(value)
  );
}

// The photo is already in storage by the time it reaches a draft — only the
// server's handle on it is kept, never the bytes.
export type DraftProblemPhoto = {
  objectId: string;
  fileName: string;
  contentType: string;
};

export type FieldReportDraft = {
  visitDate: string;
  orderPlaced: boolean | null;
  noOrderReason: NoOrderReason | null;
  missingProductIds: string[];
  shelfChecked: boolean;
  shelfCheckedTouched: boolean;
  shelfOpen: boolean;
  problemOpen: boolean;
  problemType: ProblemType | null;
  problemNote: string;
  problemPhoto: DraftProblemPhoto | null;
  notesOpen: boolean;
  notes: string;
  nextAction: string;
  nextActionDueDate: string;
};

// Bumped only when a change to the shape above cannot be absorbed by the
// tolerant parsing below — a stored draft written by a different version is
// dropped rather than half-read.
export const FIELD_REPORT_DRAFT_VERSION = 1;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseProblemPhoto(value: unknown): DraftProblemPhoto | null {
  if (typeof value !== "object" || value === null) return null;

  const photo = value as Partial<DraftProblemPhoto>;

  // Without the storage id the record points at nothing, so a partial photo is
  // dropped instead of resurfacing as an attachment the report cannot resolve.
  if (typeof photo.objectId !== "string" || !photo.objectId) return null;

  return {
    objectId: photo.objectId,
    fileName: asString(photo.fileName),
    contentType: asString(photo.contentType),
  };
}

// Reads back a draft written by this or an older build. Anything unrecognized
// degrades to the field's default rather than throwing: a rep opening a visit
// must always get a usable form, and a draft is a convenience, never a source
// of truth.
export function parseFieldReportDraft(value: unknown): FieldReportDraft | null {
  if (typeof value !== "object" || value === null) return null;

  const draft = value as Record<string, unknown>;
  const orderPlaced = draft.orderPlaced;
  const problemType = isProblemType(draft.problemType)
    ? draft.problemType
    : null;

  return {
    visitDate: asString(draft.visitDate),
    orderPlaced: typeof orderPlaced === "boolean" ? orderPlaced : null,
    // A reason without a "no order" result is not reachable through the form
    // and would render as a stranded chip, so it is only kept alongside one.
    noOrderReason:
      orderPlaced === false && isNoOrderReason(draft.noOrderReason)
        ? draft.noOrderReason
        : null,
    missingProductIds: asStringArray(draft.missingProductIds),
    shelfChecked: asBoolean(draft.shelfChecked),
    shelfCheckedTouched: asBoolean(draft.shelfCheckedTouched),
    shelfOpen: asBoolean(draft.shelfOpen),
    problemOpen: asBoolean(draft.problemOpen),
    problemType,
    problemNote: asString(draft.problemNote),
    problemPhoto: parseProblemPhoto(draft.problemPhoto),
    notesOpen: asBoolean(draft.notesOpen),
    notes: asString(draft.notes),
    nextAction: asString(draft.nextAction),
    nextActionDueDate: asString(draft.nextActionDueDate),
  };
}

// The visit date a restored draft is allowed to show. A draft outlives the
// window it was written in: drafts are swept after fourteen days, while the
// visit date only reaches a few days back. Restoring a date from outside that
// window hands the form a value it cannot display — it fails the date input's
// own `min`, which turns the submit button into a no-op behind a native
// validation bubble, and the backend would refuse the report as well. So an
// out-of-window date, like an unparseable one, degrades to today: the field's
// default, and what the collapsed date row claims anyway.
//
// The bounds are passed in because they are the form's, resolved from the clock
// at the moment the draft is read. ISO dates compare lexicographically, which is
// the whole reason this format is stored.
export function resolveDraftVisitDate(
  value: string,
  today: string,
  earliest: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  if (value > today || value < earliest) return today;

  return value;
}

// Whether the rep has actually put anything into this report. Opening a panel
// is not work: the collapsed/expanded flags are carried along so a restored
// draft comes back in the shape it was left, but on their own they are not
// worth storing a draft for — and restoring one would push the rep past the
// voice screen for nothing.
//
// `today` is passed in because the date field defaults to the day the form was
// opened; only a date the rep moved off today counts as content.
export function isEmptyFieldReportDraft(
  draft: FieldReportDraft,
  today: string,
): boolean {
  return (
    draft.orderPlaced === null &&
    draft.missingProductIds.length === 0 &&
    !draft.shelfChecked &&
    !draft.shelfCheckedTouched &&
    draft.problemType === null &&
    draft.problemNote.trim() === "" &&
    draft.problemPhoto === null &&
    draft.notes.trim() === "" &&
    draft.nextAction.trim() === "" &&
    draft.nextActionDueDate === "" &&
    (draft.visitDate === today || draft.visitDate === "")
  );
}
