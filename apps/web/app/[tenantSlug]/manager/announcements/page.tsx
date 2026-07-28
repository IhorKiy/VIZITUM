import { redirect } from "next/navigation";
import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";

import {
  AnnouncementModal,
  type AnnouncementActionResult,
} from "../../../../components/announcement-modal";
import { AppShell } from "../../../../components/app-shell";
import { ArchiveAnnouncementButton } from "../../../../components/archive-announcement-button";
import { CardFact } from "../../../../components/card-fact";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import {
  CalendarIcon,
  CheckIcon,
  UserIcon,
} from "../../../../components/icons";
import {
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementState,
  type AnnouncementWithReadStats,
} from "../../../../lib/api-client";
import { formatAnnouncementDate } from "../../../../lib/announcement-window";
import { getFormString } from "../../../../lib/form";

const ANNOUNCEMENT_STATES: readonly AnnouncementState[] = [
  "active",
  "scheduled",
  "finished",
  "archived",
];

// Notices accumulate slowly, but they do accumulate — a board that silently
// stopped at the API's maximum page would drop the oldest ones with nothing
// on screen to say so.
const PAGE_SIZE = 25;

type ManagerAnnouncementsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    announcement?: string;
    archived?: string;
    created?: string;
    error?: string;
    page?: string;
    state?: string;
    updated?: string;
  }>;
};

export default async function ManagerAnnouncementsPage({
  params,
  searchParams,
}: ManagerAnnouncementsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  // The state labels are read through their own deeply-scoped translator so
  // the lookup key stays a flat leaf — next-intl's typed keys don't resolve a
  // 3-segment relative path in this project's TS setup.
  const [timeZone, format, t, tState, tManager, tCommon] = await Promise.all([
    getTimeZone(),
    getFormatter(),
    getTranslations("manager.announcements"),
    getTranslations("manager.announcements.state"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
  // The create form defaults its start to today, and it has to be the tenant's
  // today — the same day the backend measures every window against.
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );
  const selectedState = normalizeState(pageState.state);
  const page = normalizePage(pageState.page);
  const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });

  if (selectedState) {
    query.set("state", selectedState);
  }

  query.set("page", String(page));

  // Paging links carry the active filter but not the page size, and drop the
  // page param entirely on page one so the first page has one canonical URL.
  // Changing the filter drops the page on its own — FilterForm rebuilds the
  // query from its own fields, and `page` is not one of them.
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();

    if (selectedState) {
      params.set("state", selectedState);
    }

    if (targetPage > 1) {
      params.set("page", String(targetPage));
    }

    const search = params.toString();

    return search
      ? `/${tenantSlug}/manager/announcements?${search}`
      : `/${tenantSlug}/manager/announcements`;
  };

  // The form parsing is duplicated across the two actions on purpose: a
  // "use server" function may only close over serializable data and other
  // server actions, so factoring this into a plain helper here would crash at
  // render time with a serialization error that typecheck never catches.
  async function createAnnouncementAction(
    formData: FormData,
  ): Promise<AnnouncementActionResult> {
    "use server";

    const title = getFormString(formData, "title").trim();
    const body = getFormString(formData, "body").trim();
    const startsAt = getFormString(formData, "startsAt").trim();
    const endsAt = getFormString(formData, "endsAt").trim();

    // Failures return instead of redirecting: a redirect would remount the
    // page tree and throw away everything typed into the dialog.
    if (!title || !body || !startsAt || !endsAt || endsAt < startsAt) {
      return { ok: false };
    }

    const result = await createAnnouncement({ title, body, startsAt, endsAt });

    if (!result.ok) {
      return { ok: false };
    }

    // Drops the state filter: a new announcement may well not match the one
    // that was on screen when it was written.
    redirect(`/${tenantSlug}/manager/announcements?created=1`);
  }

  async function updateAnnouncementAction(
    formData: FormData,
  ): Promise<AnnouncementActionResult> {
    "use server";

    const announcementId = getFormString(formData, "announcementId").trim();
    const title = getFormString(formData, "title").trim();
    const body = getFormString(formData, "body").trim();
    const startsAt = getFormString(formData, "startsAt").trim();
    const endsAt = getFormString(formData, "endsAt").trim();

    if (
      !announcementId ||
      !title ||
      !body ||
      !startsAt ||
      !endsAt ||
      endsAt < startsAt
    ) {
      return { ok: false };
    }

    const result = await updateAnnouncement(announcementId, {
      title,
      body,
      startsAt,
      endsAt,
    });

    if (!result.ok) {
      return { ok: false };
    }

    redirect(`/${tenantSlug}/manager/announcements?updated=1`);
  }

  async function archiveAnnouncementAction(formData: FormData) {
    "use server";

    const announcementId = getFormString(formData, "announcementId").trim();

    if (!announcementId) {
      redirect(`/${tenantSlug}/manager/announcements?error=archive`);
    }

    const result = await archiveAnnouncement(announcementId);

    if (!result.ok) {
      redirect(`/${tenantSlug}/manager/announcements?error=archive`);
    }

    redirect(`/${tenantSlug}/manager/announcements?archived=1`);
  }

  const announcementsResult = await listAnnouncements(query.toString());

  if (!announcementsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-announcements">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{announcementsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const announcements = announcementsResult.data.items;
  const totalPages = announcementsResult.data.totalPages;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-announcements">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="toolbar">
          <AnnouncementModal
            action={createAnnouncementAction}
            todayIsoDate={todayIsoDate}
          />
        </div>
      </header>

      {pageState.created ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("createdBody")}
          clearParams={["created"]}
          eyebrow={t("createdEyebrow")}
          title={t("createdTitle")}
          tone="success"
        />
      ) : null}

      {pageState.updated ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          clearParams={["updated"]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.archived ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("archivedBody")}
          clearParams={["archived"]}
          eyebrow={t("archivedEyebrow")}
          title={t("archivedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
          tone="danger"
        />
      ) : null}

      <section aria-label={t("listAria")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/manager/announcements`}>
          <div className="panel-toolbar">
            <div className="filter-groups">
              <FilterPills
                ariaLabel={t("stateFiltersAria")}
                name="state"
                options={[
                  { label: tCommon("all"), value: "" },
                  ...ANNOUNCEMENT_STATES.map((state) => ({
                    label: tState(state),
                    value: state,
                  })),
                ]}
                value={selectedState ?? ""}
              />
            </div>
          </div>
        </FilterForm>

        {announcements.length > 0 ? (
          <ul className="list-cards">
            {announcements.map((announcement: AnnouncementWithReadStats) => (
              <li
                className={`list-card announcement-card is-${announcement.state}`}
                key={announcement.id}
              >
                <div className="list-card-top">
                  <h3 className="list-card-title">
                    {announcement.title}
                    <span
                      className={`status-pill ${stateTone(announcement.state)}`}
                    >
                      {tState(announcement.state)}
                    </span>
                  </h3>
                  {/* A finished or withdrawn announcement is a record, not a
                      draft: editing it would rewrite what the team was told
                      after they were told it. */}
                  {announcement.state === "active" ||
                  announcement.state === "scheduled" ? (
                    <div className="list-card-top-actions">
                      <AnnouncementModal
                        action={updateAnnouncementAction}
                        announcement={announcement}
                        todayIsoDate={todayIsoDate}
                        trigger="icon"
                        triggerAriaLabel={t("editAria", {
                          title: announcement.title,
                        })}
                        triggerTitle={t("edit")}
                      />
                      <ArchiveAnnouncementButton
                        announcementId={announcement.id}
                        announcementTitle={announcement.title}
                        archiveAction={archiveAnnouncementAction}
                      />
                    </div>
                  ) : null}
                </div>

                <p className="announcement-body">{announcement.body}</p>

                <dl className="list-card-facts">
                  <CardFact icon={<CalendarIcon />} label={t("factWindow")}>
                    {t("window", {
                      from: formatAnnouncementDate(
                        format,
                        announcement.startsAt,
                      ),
                      to: formatAnnouncementDate(format, announcement.endsAt),
                    })}
                  </CardFact>
                  <CardFact icon={<CheckIcon />} label={t("factReads")}>
                    <ReadTally
                      announcement={announcement}
                      label={t("readOf", {
                        read: announcement.readCount,
                        total: announcement.recipientCount,
                      })}
                    />
                  </CardFact>
                  <CardFact icon={<UserIcon />} label={t("factAuthor")}>
                    {announcement.createdBy?.name ?? tCommon("unknown")}
                  </CardFact>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}

        {totalPages > 1 ? (
          <nav aria-label={t("paginationAria")} className="list-pagination">
            {page > 1 ? (
              <a className="secondary-button" href={pageHref(page - 1)}>
                {t("showNewer")}
              </a>
            ) : null}
            <p className="small-label">
              {t("pagePosition", { page, totalPages })}
            </p>
            {page < totalPages ? (
              <a className="secondary-button" href={pageHref(page + 1)}>
                {t("showEarlier")}
              </a>
            ) : null}
          </nav>
        ) : null}

        {announcements.length === 0 ? (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{selectedState ? t("emptyFilteredBody") : t("emptyBody")}</p>
            {selectedState ? (
              <div className="toolbar">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/announcements`}
                >
                  {t("showAll")}
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

// "Read by 4 of 7", with a bar behind it so a manager can tell at a glance
// whether a notice landed without reading the numbers.
function ReadTally({
  announcement,
  label,
}: {
  announcement: AnnouncementWithReadStats;
  label: string;
}) {
  const share =
    announcement.recipientCount > 0
      ? Math.min(
          100,
          Math.round(
            (announcement.readCount / announcement.recipientCount) * 100,
          ),
        )
      : 0;

  return (
    <span className="announcement-reads">
      <span
        aria-hidden="true"
        className="announcement-reads-bar"
        style={{ "--read-share": `${share}%` } as React.CSSProperties}
      />
      <span className="announcement-reads-label">{label}</span>
    </span>
  );
}

function stateTone(state: AnnouncementState): string {
  switch (state) {
    case "active":
      return "active";
    case "scheduled":
      return "warning";
    default:
      return "neutral";
  }
}

function normalizePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeState(value: string | undefined): AnnouncementState | null {
  return value && (ANNOUNCEMENT_STATES as readonly string[]).includes(value)
    ? (value as AnnouncementState)
    : null;
}
