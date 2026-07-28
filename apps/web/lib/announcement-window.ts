import type { IntlFormatter } from "./format";

// An announcement's window is a plain calendar date ("until the 31st"), not an
// instant, so it must be rendered exactly as stored. The shared date helpers
// format in the tenant's timezone, which is right for a timestamp but shifts a
// date-only value onto the previous day for any tenant west of UTC — and the
// end of a promotion is the one number a representative reads literally.
export function formatAnnouncementDate(
  format: IntlFormatter,
  value: string,
): string {
  return format.dateTime(new Date(`${value}T00:00:00.000Z`), {
    timeZone: "UTC",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
}
