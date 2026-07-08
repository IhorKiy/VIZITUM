import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  getCurrentSession,
  listLocations,
  listProducts,
  listTasks,
  listTodayRoutes,
  listVisits,
  updateTask,
  type Location,
  type Product,
  type Task,
  type TaskStatus,
} from "../../../../lib/api-client";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
  statusTone,
} from "../../../../lib/format";

type GeneralPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    task?: string;
    error?: string;
  }>;
};

export default async function GeneralPage({
  params,
  searchParams,
}: GeneralPageProps) {
  const { tenantSlug } = await params;
  const { task, error } = await searchParams;
  const [t, tField, tCommon, format] = await Promise.all([
    getTranslations("field.general"),
    getTranslations("field"),
    getTranslations("common"),
    getFormatter(),
  ]);

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    const taskId = String(formData.get("taskId") ?? "").trim();
    const status = normalizeTaskStatus(formData.get("status"));

    if (!taskId || !status) {
      redirect(`/${tenantSlug}/field/general?error=task`);
    }

    const result = await updateTask(taskId, { status });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/general?error=task`);
    }

    redirect(`/${tenantSlug}/field/general?task=updated`);
  }

  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-general">
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

  const [
    routesResult,
    visitsResult,
    locationsResult,
    tasksResult,
    productsResult,
  ] = await Promise.all([
    listTodayRoutes(),
    listVisits("pageSize=50"),
    listLocations(),
    listTasks("pageSize=50"),
    listProducts(),
  ]);

  const routes = routesResult.ok ? routesResult.data : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const products = productsResult.ok ? productsResult.data.items : [];

  const routeStops = routes.flatMap((plan) =>
    plan.items.filter((item) => item.status !== "skipped"),
  );
  const visitedStops = routeStops.filter(
    (item) => item.status === "visited",
  ).length;
  const openTasks = tasks.filter(
    (item) => item.status === "open" || item.status === "in_progress",
  );
  const completedVisits = visits.filter(
    (visit) => visit.status === "completed",
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-general">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar" aria-label={t("generalActions")}>
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {tField("backToRoute")}
          </a>
        </div>
      </header>

      {task === "updated" ? (
        <section
          className="notice-panel success"
          aria-label={t("taskStatusAria")}
        >
          <div>
            <p className="eyebrow">{t("taskUpdatedEyebrow")}</p>
            <h2>{t("taskUpdatedTitle")}</h2>
            <p>{t("taskUpdatedBody")}</p>
          </div>
        </section>
      ) : null}

      {error === "task" ? (
        <section
          className="notice-panel danger"
          aria-label={t("taskErrorAria")}
        >
          <div>
            <p className="eyebrow">{t("taskErrorEyebrow")}</p>
            <h2>{t("taskErrorTitle")}</h2>
            <p>{t("taskErrorBody")}</p>
          </div>
        </section>
      ) : null}

      <div className="general-stack">
        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("summary")}</h2>
          </summary>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{t("routeStops")}</th>
                <td>{routeStops.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("visited")}</th>
                <td>{visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">{t("remaining")}</th>
                <td>{routeStops.length - visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">{t("completedVisits")}</th>
                <td>{completedVisits}</td>
              </tr>
              <tr>
                <th scope="row">{t("openTasks")}</th>
                <td>{openTasks.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("locations")}</th>
                <td>{locations.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("products")}</th>
                <td>{products.length}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("locations")}</h2>
          </summary>
          {locations.length > 0 ? (
            <div className="field-card-list">
              {locations.map((location: Location) => (
                <article className="location-mini-card" key={location.id}>
                  <header>
                    <div>
                      <h3>{location.name}</h3>
                      <p>
                        {[location.addressLine, location.city]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${statusTone(location.status)}`}
                    >
                      {formatEnumLabel(tCommon, location.status)}
                    </span>
                  </header>
                  <p className="visit-meta">
                    {[location.type, location.region, location.territory]
                      .filter(Boolean)
                      .map((value) => formatEnumLabel(tCommon, String(value)))
                      .join(" · ") || t("noSegmentDetails")}
                  </p>
                  {location.notes ? (
                    <p className="form-hint">{location.notes}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("noLocations")}</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("products")}</h2>
          </summary>
          {products.length > 0 ? (
            <div className="field-card-list">
              {products.map((product: Product) => (
                <article className="location-mini-card" key={product.id}>
                  <header>
                    <div>
                      <h3>{product.name}</h3>
                      <p>
                        {[product.category, product.sku]
                          .filter(Boolean)
                          .map((value) => String(value))
                          .join(" · ") || t("noCatalogueDetails")}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${statusTone(product.status)}`}
                    >
                      {formatEnumLabel(tCommon, product.status)}
                    </span>
                  </header>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("noProducts")}</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("myTasks")}</h2>
          </summary>
          {openTasks.length > 0 ? (
            <div className="field-card-list">
              {openTasks.map((item: Task) => (
                <article className="location-mini-card" key={item.id}>
                  <header>
                    <div>
                      <h3>{item.title}</h3>
                      <p>
                        {item.location
                          ? `${item.location.name} · ${item.location.city}`
                          : t("noLocation")}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${statusPillTone(item.status)}`}
                    >
                      {formatEnumLabel(tCommon, item.status)}
                    </span>
                  </header>
                  <p className="visit-meta">
                    {item.description ?? t("noTaskDetails")}
                  </p>
                  <p className="form-hint">
                    {t("priorityDue", {
                      priority: formatEnumLabel(tCommon, item.priority),
                      due: formatDateTime(
                        format,
                        item.dueDate,
                        tCommon("notSet"),
                      ),
                    })}
                  </p>
                  <form
                    action={updateTaskStatusAction}
                    className="inline-control-form"
                  >
                    <input name="taskId" type="hidden" value={item.id} />
                    <select
                      aria-label={t("updateTaskStatusAria", {
                        title: item.title,
                      })}
                      defaultValue={item.status}
                      name="status"
                    >
                      <option value="open">
                        {formatEnumLabel(tCommon, "open")}
                      </option>
                      <option value="in_progress">
                        {formatEnumLabel(tCommon, "in_progress")}
                      </option>
                      <option value="done">
                        {formatEnumLabel(tCommon, "done")}
                      </option>
                      <option value="cancelled">
                        {formatEnumLabel(tCommon, "cancelled")}
                      </option>
                    </select>
                    <PendingSubmitButton
                      className="secondary-button"
                      pendingLabel={tCommon("saving")}
                    >
                      {tCommon("save")}
                    </PendingSubmitButton>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("noTasks")}</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("faq")}</h2>
          </summary>
          <div className="faq-list">
            <details className="faq-item">
              <summary className="faq-question">{t("faq1Question")}</summary>
              <p className="faq-answer">{t("faq1Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq2Question")}</summary>
              <p className="faq-answer">{t("faq2Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq3Question")}</summary>
              <p className="faq-answer">{t("faq3Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq4Question")}</summary>
              <p className="faq-answer">{t("faq4Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq5Question")}</summary>
              <p className="faq-answer">{t("faq5Answer")}</p>
            </details>
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function normalizeTaskStatus(
  value: FormDataEntryValue | null,
): TaskStatus | null {
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}
