import { getFormatter, getTranslations } from "next-intl/server";

import { formatAnnouncementDate } from "../lib/announcement-window";
import type { ActiveAnnouncement } from "../lib/api-client";
import { CheckIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type AnnouncementFeedProps = {
  announcements: ActiveAnnouncement[];
  markReadAction: (formData: FormData) => Promise<void>;
};

// What the manager has put on the board and is in force today. Unread notices
// sit open at the top of the home screen, because the point of the board is
// that nobody has to go looking for it; the ones already acknowledged fold
// away so a month of standing rules never buries the day's route.
export async function AnnouncementFeed({
  announcements,
  markReadAction,
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

  return (
    <section aria-label={t("sectionAria")} className="announcement-feed">
      <h2 className="announcement-feed-heading">
        {t("heading")}
        {unread.length > 0 ? (
          <span className="announcement-feed-count">{unread.length}</span>
        ) : null}
      </h2>

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
        <details className="announcement-feed-read">
          <summary>{t("readCount", { count: read.length })}</summary>
          {read.map((announcement) => (
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
          ))}
        </details>
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
