import { getFormatter, getTranslations } from "next-intl/server";

import { formatAnnouncementDate } from "../lib/announcement-window";
import type { ActiveAnnouncement } from "../lib/api-client";
import { CheckIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type AnnouncementFeedProps = {
  announcements: ActiveAnnouncement[];
  markReadAction: (formData: FormData) => Promise<void>;
  /**
   * Off on the dedicated screen, which already carries the board's name in its
   * own page header — the section sits under the greeting on the home screen,
   * where it needs to say what it is.
   */
  showHeading?: boolean;
  /**
   * Whether the acknowledged notices hide behind a disclosure. They do wherever
   * the board is a guest on someone else's screen; on the screen that exists to
   * show the board, folding away most of it would be the whole point missed.
   */
  foldRead?: boolean;
};

// What the manager has put on the board and is in force today. Rendered in two
// places, and what each one passes in is the difference between them: the home
// screen hands over only the unread notices, because the point of the board is
// that nobody has to go looking for what they haven't seen — and the whole
// section disappears once they are acknowledged, rather than leaving a folded
// row on top of the day's route. The announcements screen off the field menu
// (/field/announcements) hands over the full board, where the already-read ones
// fold away under a disclosure instead of burying the ones still in force.
export async function AnnouncementFeed({
  announcements,
  foldRead = true,
  markReadAction,
  showHeading = true,
}: AnnouncementFeedProps) {
  const [t, format] = await Promise.all([
    getTranslations("field.announcements"),
    getFormatter(),
  ]);

  if (announcements.length === 0) {
    return null;
  }

  const unread = announcements.filter((announcement) => !announcement.isRead);
  const read = announcements.filter((announcement) => announcement.isRead);
  // Same cards either way — only whether they sit behind a disclosure differs.
  const readCards = read.map((announcement) => (
    <AnnouncementCard
      announcement={announcement}
      endsLabel={t("endsOn", {
        date: formatAnnouncementDate(format, announcement.endsAt),
      })}
      key={announcement.id}
      markReadLabel={t("markRead")}
      markingLabel={t("marking")}
      newLabel={t("newBadge")}
    />
  ));

  return (
    <section aria-label={t("sectionAria")} className="announcement-feed">
      {showHeading ? (
        <h2 className="announcement-feed-heading">
          {t("heading")}
          {unread.length > 0 ? (
            <span className="announcement-feed-count">{unread.length}</span>
          ) : null}
        </h2>
      ) : null}

      {unread.map((announcement) => (
        <AnnouncementCard
          announcement={announcement}
          endsLabel={t("endsOn", {
            date: formatAnnouncementDate(format, announcement.endsAt),
          })}
          key={announcement.id}
          markReadAction={markReadAction}
          markReadLabel={t("markRead")}
          markingLabel={t("marking")}
          newLabel={t("newBadge")}
        />
      ))}

      {read.length > 0 ? (
        foldRead ? (
          <details className="announcement-feed-read">
            <summary>{t("readCount", { count: read.length })}</summary>
            {readCards}
          </details>
        ) : (
          <div className="announcement-feed-read is-open">
            <p className="announcement-feed-read-label">
              {t("readCount", { count: read.length })}
            </p>
            {readCards}
          </div>
        )
      ) : null}
    </section>
  );
}

function AnnouncementCard({
  announcement,
  endsLabel,
  markReadAction,
  markReadLabel,
  markingLabel,
  newLabel,
}: {
  announcement: ActiveAnnouncement;
  endsLabel: string;
  // Absent for an already-read card: there is nothing left to acknowledge.
  markReadAction?: (formData: FormData) => Promise<void>;
  markReadLabel: string;
  markingLabel: string;
  newLabel: string;
}) {
  return (
    <article
      className={`announcement-note${announcement.isRead ? "" : " is-unread"}`}
    >
      <div className="announcement-note-top">
        <h3>{announcement.title}</h3>
        {announcement.isRead ? null : (
          <span className="announcement-new-tag">{newLabel}</span>
        )}
      </div>
      <p className="announcement-note-body">{announcement.body}</p>
      <div className="announcement-note-foot">
        <span className="announcement-note-window">{endsLabel}</span>
        {markReadAction ? (
          <form action={markReadAction}>
            <input
              name="announcementId"
              type="hidden"
              value={announcement.id}
            />
            <PendingSubmitButton
              className="secondary-button announcement-read-button"
              pendingLabel={markingLabel}
            >
              <CheckIcon />
              {markReadLabel}
            </PendingSubmitButton>
          </form>
        ) : null}
      </div>
    </article>
  );
}
