import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { BackLink } from "../../../../components/back-link";
import { DeleteRouteButton } from "../../../../components/delete-route-button";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { GripIcon, MapPinIcon, RouteIcon } from "../../../../components/icons";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { RenameRouteButton } from "../../../../components/rename-route-button";
import {
  addRouteTemplateItem,
  createRouteTemplate,
  deleteRouteTemplate,
  deleteRouteTemplateItem,
  getCurrentSession,
  getRouteTemplate,
  listLocations,
  listRouteTemplates,
  reorderRouteTemplateItems,
  updateRouteTemplate,
  type Location,
  type RouteTemplate,
} from "../../../../lib/api-client";
import { resolveBackTarget } from "../../../../lib/back-navigation";
import type { CommonTranslator } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import { RouteStopDragList } from "./route-stop-drag-list";

type RoutesPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    from?: string;
    route?: string;
    template?: string;
  }>;
};

export default async function RoutesPage({
  params,
  searchParams,
}: RoutesPageProps) {
  const { tenantSlug } = await params;
  const { from, route, template } = await searchParams;
  // Opened from the field menu, which hangs off every field screen, so where
  // "back" lands is whatever screen the menu was opened on — and from
  // planning's "no routes yet" empty state, which is the other way in.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
  const [t, tBack, tCommon] = await Promise.all([
    getTranslations("field.routes"),
    getTranslations("common.back"),
    getTranslations("common"),
  ]);

  async function createRouteTemplateAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const sessionResult = await getCurrentSession();

    if (!name || !sessionResult.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: "new", status: "failed" }),
      );
    }

    const result = await createRouteTemplate({
      representativeUserId: sessionResult.data.user.id,
      name,
    });

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: "new", status: "failed" }),
      );
    }

    redirect(
      routesHref(tenantSlug, {
        from,
        routeId: result.data.id,
        status: "created",
      }),
    );
  }

  async function deleteRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();

    if (!templateId) {
      redirect(routesHref(tenantSlug, { from, status: "failed" }));
    }

    const result = await deleteRouteTemplate(templateId);

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: templateId, status: "failed" }),
      );
    }

    redirect(routesHref(tenantSlug, { from, status: "deleted" }));
  }

  async function addTemplateStopAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const locationId = getFormString(formData, "locationId").trim();

    if (!templateId || !locationId) {
      redirect(
        routesHref(tenantSlug, {
          from,
          routeId: templateId || undefined,
          status: "failed",
        }),
      );
    }

    const activeTemplate = await findOwnRouteTemplate(templateId);

    if (!activeTemplate) {
      redirect(routesHref(tenantSlug, { from, status: "failed" }));
    }

    const nextSequence = activeTemplate.items.length
      ? Math.max(...activeTemplate.items.map((item) => item.sequence)) + 1
      : 1;

    const result = await addRouteTemplateItem(templateId, {
      locationId,
      sequence: nextSequence,
    });

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: templateId, status: "failed" }),
      );
    }

    redirect(
      routesHref(tenantSlug, {
        from,
        routeId: templateId,
        status: "item-added",
      }),
    );
  }

  async function removeTemplateStopAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const itemId = getFormString(formData, "itemId").trim();

    if (!templateId || !itemId) {
      redirect(
        routesHref(tenantSlug, {
          from,
          routeId: templateId || undefined,
          status: "failed",
        }),
      );
    }

    const result = await deleteRouteTemplateItem(templateId, itemId);

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: templateId, status: "failed" }),
      );
    }

    redirect(
      routesHref(tenantSlug, {
        from,
        routeId: templateId,
        status: "item-removed",
      }),
    );
  }

  async function renameRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const name = getFormString(formData, "name").trim();

    if (!templateId || !name) {
      redirect(
        routesHref(tenantSlug, {
          from,
          routeId: templateId || undefined,
          status: "failed",
        }),
      );
    }

    const result = await updateRouteTemplate(templateId, { name });

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: templateId, status: "failed" }),
      );
    }

    redirect(
      routesHref(tenantSlug, { from, routeId: templateId, status: "renamed" }),
    );
  }

  // Called directly from the client-side drag list (not a <form> submit) once
  // a drag or arrow-key move settles on a new order — see
  // route-stop-drag-list.tsx.
  async function reorderTemplateStopsAction(
    templateId: string,
    itemIds: string[],
  ) {
    "use server";

    if (!templateId || itemIds.length === 0) {
      redirect(
        routesHref(tenantSlug, {
          from,
          routeId: templateId || undefined,
          status: "failed",
        }),
      );
    }

    const result = await reorderRouteTemplateItems(templateId, itemIds);

    if (!result.ok) {
      redirect(
        routesHref(tenantSlug, { from, routeId: templateId, status: "failed" }),
      );
    }

    // No success notice here — the drag itself (or the arrow-key move) is
    // already the feedback; a banner on top of every reorder would be noise.
    redirect(routesHref(tenantSlug, { from, routeId: templateId }));
  }

  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-menu">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
          <div
            className="toolbar"
            aria-label={tCommon("notice.sessionActions")}
          >
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
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{sessionResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  // Explicit `representativeUserId` so a caller who also holds
  // `routes.manage_team` (e.g. this repo's "all roles" demo account) still
  // sees their own routes here — without it, the backend treats an omitted
  // filter as "team view" and requires the param instead of defaulting to self.
  const ownRepresentativeQuery = `representativeUserId=${sessionResult.data.user.id}`;
  const [templatesResult, locationsResult] = await Promise.all([
    listRouteTemplates(`pageSize=100&${ownRepresentativeQuery}`),
    listLocations(),
  ]);
  const routeTemplates = templatesResult.ok ? templatesResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];

  const isCreatingTemplate = route === "new";
  const activeTemplate =
    route && !isCreatingTemplate
      ? routeTemplates.find((item) => item.id === route)
      : undefined;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-menu">
      {/* Drilling into a route replaces the title with the route's own header
          and a back link, rather than stacking a second navigation layer — so
          the way out of the screen itself is only offered at the list level,
          where the route detail's own back link isn't already there. */}
      {!activeTemplate && !isCreatingTemplate && (
        <header className="page-header page-header--compact">
          <BackLink
            href={backTarget.href}
            inline
            label={tBack(backTarget.labelKey)}
          />
          <h1>{t("title")}</h1>
        </header>
      )}

      <RoutesView
        activeTemplate={activeTemplate}
        addTemplateStopAction={addTemplateStopAction}
        createRouteTemplateAction={createRouteTemplateAction}
        deleteRouteTemplateAction={deleteRouteTemplateAction}
        from={from}
        isCreatingTemplate={isCreatingTemplate}
        locations={locations}
        removeTemplateStopAction={removeTemplateStopAction}
        renameRouteTemplateAction={renameRouteTemplateAction}
        reorderTemplateStopsAction={reorderTemplateStopsAction}
        routeTemplates={routeTemplates}
        t={t}
        tBack={tBack}
        tCommon={tCommon}
        tenantSlug={tenantSlug}
        templateStatus={template}
      />
    </AppShell>
  );
}

type RoutesTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.routes">>
>;
type BackTranslator = Awaited<
  ReturnType<typeof getTranslations<"common.back">>
>;
type ServerAction = (formData: FormData) => Promise<void>;
type ReorderAction = (templateId: string, itemIds: string[]) => Promise<void>;

function RoutesView({
  activeTemplate,
  addTemplateStopAction,
  createRouteTemplateAction,
  deleteRouteTemplateAction,
  from,
  isCreatingTemplate,
  locations,
  removeTemplateStopAction,
  renameRouteTemplateAction,
  reorderTemplateStopsAction,
  routeTemplates,
  t,
  tBack,
  tCommon,
  tenantSlug,
  templateStatus,
}: {
  activeTemplate: RouteTemplate | undefined;
  addTemplateStopAction: ServerAction;
  createRouteTemplateAction: ServerAction;
  deleteRouteTemplateAction: ServerAction;
  /** Tenant-relative origin to carry through this screen's own links. */
  from: string | undefined;
  isCreatingTemplate: boolean;
  locations: Location[];
  removeTemplateStopAction: ServerAction;
  renameRouteTemplateAction: ServerAction;
  reorderTemplateStopsAction: ReorderAction;
  routeTemplates: RouteTemplate[];
  t: RoutesTranslator;
  tBack: BackTranslator;
  tCommon: CommonTranslator;
  tenantSlug: string;
  templateStatus: string | undefined;
}) {
  const statusNotice = buildTemplateStatusNotice(templateStatus, t, tCommon);

  if (isCreatingTemplate) {
    return (
      <div className="panel">
        <div className="panel-title-stack">
          <h2>{t("addRoute")}</h2>
        </div>
        <form action={createRouteTemplateAction} className="visit-form compact">
          <label>
            {t("createRouteNameLabel")}
            <input
              autoFocus
              maxLength={INPUT_LIMITS.name}
              name="name"
              required
              type="text"
            />
          </label>
          <div className="toolbar">
            <Link
              className="secondary-button"
              href={routesHref(tenantSlug, { from })}
            >
              {tCommon("cancel")}
            </Link>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("creatingRoute")}
            >
              {t("createRouteSubmit")}
            </PendingSubmitButton>
          </div>
        </form>
      </div>
    );
  }

  if (activeTemplate) {
    const usedLocationIds = new Set(
      activeTemplate.items.map((item) => item.locationId),
    );
    const availableLocations = locations.filter(
      (location) => !usedLocationIds.has(location.id),
    );
    const stops = [...activeTemplate.items].sort(
      (a, b) => a.sequence - b.sequence,
    );

    return (
      <>
        {statusNotice}

        <BackLink
          href={routesHref(tenantSlug, { from })}
          label={tBack("routes")}
        />

        <div className="route-name-card">
          <div className="route-name-summary">
            <div>
              <h2>{activeTemplate.name}</h2>
              <p className="route-name-meta">
                <MapPinIcon />
                {t("routeStopsCount", { count: stops.length })}
              </p>
            </div>
            <span className="route-name-actions">
              <RenameRouteButton
                renameAction={renameRouteTemplateAction}
                templateId={activeTemplate.id}
                templateName={activeTemplate.name}
              />
              <DeleteRouteButton
                deleteAction={deleteRouteTemplateAction}
                routeId={activeTemplate.id}
                routeName={activeTemplate.name}
              />
            </span>
          </div>
        </div>

        <details className="route-add-stop">
          <summary className="route-add-stop-trigger">
            <span aria-hidden="true">+</span> {t("addStop")}
          </summary>
          {availableLocations.length > 0 ? (
            <form action={addTemplateStopAction} className="visit-form compact">
              <input
                name="templateId"
                type="hidden"
                value={activeTemplate.id}
              />
              <label>
                {t("locationLabel")}
                <select name="locationId" required>
                  {availableLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.city ? ` · ${location.city}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={t("adding")}
              >
                {t("addToRoute")}
              </PendingSubmitButton>
            </form>
          ) : (
            <p className="empty-state">
              {locations.length === 0
                ? t("noLocations")
                : t("allLocationsUsed")}
            </p>
          )}
        </details>

        {stops.length > 0 ? (
          <>
            <div className="route-stops-section-head">
              <p className="route-stops-section-label">
                {t("stopsSectionLabel")}
              </p>
              <p className="route-stops-drag-hint">
                <GripIcon />
                {t("dragToReorderHint")}
              </p>
            </div>
            <RouteStopDragList
              removeAction={removeTemplateStopAction}
              reorderAction={reorderTemplateStopsAction}
              stops={stops}
              templateId={activeTemplate.id}
              tenantSlug={tenantSlug}
            />
          </>
        ) : (
          <p className="empty-state">{t("noStops")}</p>
        )}
      </>
    );
  }

  return (
    <>
      {statusNotice}
      <div className="panel">
        <Link
          className="dashed-action-button route-add-trigger"
          href={routesHref(tenantSlug, { from, routeId: "new" })}
        >
          + {t("addRoute")}
        </Link>

        {routeTemplates.length > 0 ? (
          <>
            <p className="small-label route-count-label">
              {t("routesCountLabel", { count: routeTemplates.length })}
            </p>
            <ul className="route-card-list">
              {routeTemplates.map((routeTemplate) => (
                <li key={routeTemplate.id}>
                  <Link
                    className="route-card"
                    href={routesHref(tenantSlug, {
                      from,
                      routeId: routeTemplate.id,
                    })}
                  >
                    <span className="route-card-icon" aria-hidden="true">
                      <RouteIcon />
                    </span>
                    <span className="route-card-body">
                      <h3>{routeTemplate.name}</h3>
                      <span className="route-card-meta">
                        <MapPinIcon />
                        {t("routeStopsCount", {
                          count: routeTemplate.items.length,
                        })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyRoutesTitle")}</h2>
            <p>{t("emptyRoutesBody")}</p>
          </div>
        )}
      </div>
    </>
  );
}

function buildTemplateStatusNotice(
  status: string | undefined,
  t: RoutesTranslator,
  tCommon: CommonTranslator,
) {
  if (!status) {
    return null;
  }

  // Success entries stay title-only so they render as the compact line;
  // "deleted" keeps its body because it carries a real caveat (days already
  // assigned from the route keep their stops).
  const noticeMap: Record<
    string,
    { title: string; body?: string; tone: "success" | "danger" } | undefined
  > = {
    created: {
      title: t("routeCreatedTitle"),
      tone: "success",
    },
    renamed: {
      title: t("renamedTitle"),
      tone: "success",
    },
    deleted: {
      title: t("routeDeletedTitle"),
      body: t("routeDeletedBody"),
      tone: "success",
    },
    "item-added": {
      title: t("itemAddedTitle"),
      tone: "success",
    },
    "item-removed": {
      title: t("itemRemovedTitle"),
      tone: "success",
    },
    failed: {
      title: t("failedTitle"),
      body: t("failedBody"),
      tone: "danger",
    },
  };

  const notice = noticeMap[status];

  if (!notice) {
    return null;
  }

  return (
    <DismissableNotice
      ariaLabel={t("statusAria")}
      body={notice.body}
      clearParams={["template"]}
      eyebrow={
        notice.tone === "success"
          ? tCommon("notice.updated")
          : tCommon("notice.error")
      }
      title={notice.title}
      tone={notice.tone}
    />
  );
}

// Same reasoning as the ownRepresentativeQuery in the page body: an explicit
// representativeUserId is required so a caller who also holds
// `routes.manage_team` still gets their own template back instead of a
// backend 403 (an omitted filter means "team view", not "self").
async function findOwnRouteTemplate(
  templateId: string,
): Promise<RouteTemplate | undefined> {
  // findTenantRouteTemplate (behind this endpoint) already scopes by
  // ownership server-side, so this needs no representativeUserId of its
  // own — just the one template, not the caller's whole list.
  const result = await getRouteTemplate(templateId);

  return result.ok ? result.data : undefined;
}

function routesHref(
  tenantSlug: string,
  {
    from,
    routeId,
    status,
  }: { from?: string; routeId?: string; status?: string } = {},
): string {
  const params = new URLSearchParams();
  if (routeId) {
    params.set("route", routeId);
  }
  if (status) {
    params.set("template", status);
  }
  // The origin rides along through every link and every server-action redirect
  // on this screen: opening a route, renaming it or adding a stop must not
  // quietly repoint the back control at the home screen.
  if (from) {
    params.set("from", from);
  }
  const search = params.toString();

  return search
    ? `/${tenantSlug}/field/routes?${search}`
    : `/${tenantSlug}/field/routes`;
}
