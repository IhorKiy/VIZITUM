/**
 * Reads every page of a paginated list endpoint, for the screens that need
 * the whole answer rather than the first page of it.
 *
 * A date-range filter bounds *which* rows come back, but not how many: the
 * API caps `pageSize` at 100 (`MAX_PAGE_SIZE`, src/common/pagination.ts)
 * whatever a caller asks for, so a range that holds more than that arrives
 * truncated — and truncated by `planDate desc`, which drops the *earliest*
 * days. A month calendar rendered from that first page shows its opening week
 * as unplanned, which is indistinguishable from nothing being planned.
 */

/** Only the two fields paging needs; the real envelope carries more. */
type PageEnvelope<TItem> = {
  items: TItem[];
  totalPages: number;
};

export type PageResult<TItem> =
  { ok: true; data: PageEnvelope<TItem> } | { ok: false };

/**
 * Backstop on a runaway loop, not a real limit: at the API's 100-row cap this
 * is 2000 rows, far past any range a person can put on screen. It exists so a
 * nonsense `totalPages` cannot spin the server component.
 */
export const MAX_COLLECTED_PAGES = 20;

/**
 * Every item across every page, or `null` if any page failed.
 *
 * Failure is all-or-nothing on purpose: handing back the pages that did
 * arrive would put a partially-filled calendar on screen that looks complete,
 * which is the exact failure this helper exists to prevent. Callers already
 * treat a failed read as an empty list.
 *
 * Pages after the first are fetched together rather than in sequence — the
 * first response already says how many there are — and `Promise.all` keeps
 * them in page order, so the caller sees the same sequence the API would have
 * returned.
 */
export async function collectAllPages<TItem>(
  fetchPage: (page: number) => Promise<PageResult<TItem>>,
  maxPages: number = MAX_COLLECTED_PAGES,
): Promise<TItem[] | null> {
  const first = await fetchPage(1);

  if (!first.ok) {
    return null;
  }

  // A non-finite `totalPages` (an older API, a body that didn't carry it)
  // reads as "just this page" rather than as a loop bound of NaN.
  const totalPages = Number.isFinite(first.data.totalPages)
    ? first.data.totalPages
    : 1;
  const lastPage = Math.min(Math.max(totalPages, 1), maxPages);

  if (lastPage <= 1) {
    return first.data.items;
  }

  const rest = await Promise.all(
    Array.from({ length: lastPage - 1 }, (_, index) => fetchPage(index + 2)),
  );

  const items = [...first.data.items];

  for (const page of rest) {
    if (!page.ok) {
      return null;
    }

    items.push(...page.data.items);
  }

  return items;
}
