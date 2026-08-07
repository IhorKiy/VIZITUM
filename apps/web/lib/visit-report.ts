/**
 * The storage id of the photo attached to a confirmed report's problem, if it
 * has one — dug out of `confirmedData`, which is `unknown` by the time it
 * reaches the frontend (the report is stored as the JSON it was confirmed as).
 *
 * Shared because the photo has to be presigned by whoever renders the report,
 * and that is now two screens: the visit page and the history list's sheet.
 * Every step is checked rather than cast: a report written by an older build,
 * or against a schema version this one does not know, has to come back as "no
 * photo" instead of throwing the screen away.
 */
export function problemPhotoObjectIdFromReport(
  confirmedData: unknown,
): string | null {
  if (typeof confirmedData !== "object" || confirmedData === null) {
    return null;
  }

  const fieldReport = (confirmedData as { fieldReport?: unknown }).fieldReport;

  if (typeof fieldReport !== "object" || fieldReport === null) {
    return null;
  }

  const problem = (fieldReport as { problem?: unknown }).problem;

  if (typeof problem !== "object" || problem === null) {
    return null;
  }

  const photoObjectId = (problem as { photoObjectId?: unknown }).photoObjectId;

  return typeof photoObjectId === "string" && photoObjectId
    ? photoObjectId
    : null;
}
