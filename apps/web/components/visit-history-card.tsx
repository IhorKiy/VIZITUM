import { useFormatter } from "next-intl";
import type { ReactNode } from "react";

import { ChevronRightIcon } from "./icons";
import type { VisitStatus } from "../lib/api-client";

/**
 * Which colour a visit's row wears — its date block, its dot and its edge.
 *
 * The visit statuses, not the shared `statusPillTone`: that one answers "how
 * loud should this badge be" for every list in the product and puts a cancelled
 * visit in the same gold as an unfinished one. On a history row the two are the
 * opposite signals a rep scans for — a cancelled visit is closed and needs
 * nothing, an unconfirmed report is the loose end they came here to find — so
 * this maps them apart: gold stays the attention colour it is everywhere in
 * this zone, and cancelled takes the danger red its reason line already uses.
 */
export function visitRowTone(status: VisitStatus): string {
  if (status === "completed") {
    return "is-completed";
  }

  if (status === "cancelled") {
    return "is-cancelled";
  }

  if (status === "in_progress") {
    return "is-unfinished";
  }

  return "is-draft";
}

type VisitHistoryCardProps = {
  // The visit's own day — drawn as the date block on the left, and never read
  // out: every caller renders these under a heading that already names the day
  // (the field history) or on a screen about one location's visits, where the
  // date is the row's own title.
  date: Date;
  href: string;
  // Why a cancelled visit was cancelled, already worded by the caller. The one
  // thing the row cannot say with colour alone.
  reason?: string;
  status: VisitStatus;
  // The status in words. The dot is colour and nothing else, so this is what a
  // screen reader is given.
  statusLabel: string;
  subtitle?: string;
  subtitleIcon?: ReactNode;
  title: string;
};

/**
 * One visit in a history list: the day it happened on, what it was, and how it
 * ended — as a single row a thumb can hit.
 *
 * The date leads because a history is read by when: the block on the left is
 * the same width on every row, so the dates line up into a column the eye runs
 * down, which a date buried in a line of prose never does. What the visit *was*
 * takes the row's own line, and how it ended is a dot beside it — the status
 * was a pill on the right until it started wrapping location names on a phone,
 * and a word that says "completed" on nine rows out of ten earns less room than
 * the location it belongs to.
 *
 * Shared by the field visit history and a location's own visit history, which
 * differ only in what the two lines say.
 */
export function VisitHistoryCard({
  date,
  href,
  reason,
  status,
  statusLabel,
  subtitle,
  subtitleIcon,
  title,
}: VisitHistoryCardProps) {
  const format = useFormatter();

  return (
    <a className={`visit-row ${visitRowTone(status)}`} href={href}>
      <div aria-hidden="true" className="visit-row-date">
        <b>{format.dateTime(date, { day: "numeric" })}</b>
        <i>{format.dateTime(date, { month: "short" })}</i>
      </div>
      <div className="visit-row-main">
        <div className="visit-row-title">
          <h3>{title}</h3>
          <span aria-hidden="true" className="visit-row-dot" />
          <span className="sr-only">{statusLabel}</span>
        </div>
        {subtitle ? (
          <p className="visit-row-sub">
            {subtitleIcon ? (
              <span aria-hidden="true" className="visit-row-sub-icon">
                {subtitleIcon}
              </span>
            ) : null}
            {subtitle}
          </p>
        ) : null}
        {reason ? <p className="visit-row-reason">{reason}</p> : null}
      </div>
      <span aria-hidden="true" className="visit-row-chevron">
        <ChevronRightIcon />
      </span>
    </a>
  );
}
