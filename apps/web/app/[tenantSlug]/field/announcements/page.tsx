import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AnnouncementFeed } from "../../../../components/announcement-feed";
import { AppShell } from "../../../../components/app-shell";
import { BackLink } from "../../../../components/back-link";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import {
  getCurrentSession,
  listActiveAnnouncements,
  markAnnouncementRead,
} from "../../../../lib/api-client";
import {
  resolveBackTarget,
  withBackOrigin,
} from "../../../../lib/back-navigation";
import { getFormString } from "../../../../lib/form";

type FieldAnnouncementsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    // Set by a failed mark-read redirect, same shape the home screen uses.
    announcement?: string;
    from?: string;
  }>;
};

// The full notice board, read ones included — the home screen only carries what
// is still unread, so this is where a rep goes back to a standing rule they
// already acknowledged. Opened from the field menu.
export default async function FieldAnnouncementsPage({
  params,
  searchParams,
}: FieldAnnouncementsPageProps) {
  const { tenantSlug } = await params;
  const { announcement, from } = await searchParams;
  const [t, tField, tBack, tCommon] = await Promise.all([
    getTranslations("field.announcements"),
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("announcements.read")
  ) {
    return (
      <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("heading")}</h1>
            <p>{t("permissionBody")}</p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          aria-label={t("permissionStatusAria")}
          className="notice-panel"
        >
          <div>
            <p className="eyebrow">{t("permissionRequiredEyebrow")}</p>
            <h2>{t("permissionRequiredTitle")}</h2>
            <p>{t("permissionRequiredBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  // Opened from the field menu, which hangs off every field screen, so where
  // "back" lands is whatever screen the menu was opened on.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
  const announcementsResult = await listActiveAnnouncements();
  const announcements = announcementsResult.ok
    ? announcementsResult.data.items
    : [];

  // Acknowledging works here as well as on the home screen: a rep who opened
  // the board from the menu shouldn't have to go back to the route to say they
  // read something. The origin rides along so the back control survives it.
  async function markAnnouncementReadAction(formData: FormData) {
    "use server";

    const announcementId = getFormString(formData, "announcementId").trim();
    const listHref = `/${tenantSlug}/field/announcements`;
    const failedHref = `${listHref}?announcement=failed`;

    if (!announcementId) {
      redirect(from ? withBackOrigin(failedHref, from) : failedHref);
    }

    const result = await markAnnouncementRead(announcementId);
    const target = result.ok ? listHref : failedHref;

    redirect(from ? withBackOrigin(target, from) : target);
  }

  return (
    <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
      <header className="page-header page-header--compact">
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <h1>{t("heading")}</h1>
      </header>

      {announcement === "failed" ? (
        <DismissableNotice
          ariaLabel={t("sectionAria")}
          body={t("markFailedBody")}
          clearParams={["announcement"]}
          title={t("markFailedTitle")}
          tone="danger"
        />
      ) : null}

      {announcementsResult.ok ? (
        announcements.length > 0 ? (
          <AnnouncementFeed
            announcements={announcements}
            foldRead={false}
            markReadAction={markAnnouncementReadAction}
            showHeading={false}
          />
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
          </div>
        )
      ) : (
        <section
          aria-label={tCommon("notice.apiStatus")}
          className="notice-panel"
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{announcementsResult.message}</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
