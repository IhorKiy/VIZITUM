import { redirect } from "next/navigation";

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
  formatLabel,
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
            <p className="eyebrow">General</p>
            <h1>Reference &amp; summary</h1>
            <p>Sign in to view your locations, products and daily summary.</p>
          </div>
          <div className="toolbar" aria-label="Session actions">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Backend session is not connected</h2>
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
          <p className="eyebrow">General</p>
          <h1>Reference &amp; summary</h1>
          <p>
            Your daily summary, locations and product catalogue in one place.
          </p>
        </div>
        <div className="toolbar" aria-label="General actions">
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            Back to route
          </a>
        </div>
      </header>

      {task === "updated" ? (
        <section className="notice-panel success" aria-label="Task status">
          <div>
            <p className="eyebrow">Task updated</p>
            <h2>Follow-up saved</h2>
            <p>The task status was updated for your field queue.</p>
          </div>
        </section>
      ) : null}

      {error === "task" ? (
        <section className="notice-panel danger" aria-label="Task error">
          <div>
            <p className="eyebrow">Task not updated</p>
            <h2>Follow-up update failed</h2>
            <p>Refresh and try again.</p>
          </div>
        </section>
      ) : null}

      <div className="general-stack">
        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>Summary</h2>
          </summary>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Route stops</th>
                <td>{routeStops.length}</td>
              </tr>
              <tr>
                <th scope="row">Visited</th>
                <td>{visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">Remaining</th>
                <td>{routeStops.length - visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">Completed visits</th>
                <td>{completedVisits}</td>
              </tr>
              <tr>
                <th scope="row">Open tasks</th>
                <td>{openTasks.length}</td>
              </tr>
              <tr>
                <th scope="row">Locations</th>
                <td>{locations.length}</td>
              </tr>
              <tr>
                <th scope="row">Products</th>
                <td>{products.length}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>Locations</h2>
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
                      {formatLabel(location.status)}
                    </span>
                  </header>
                  <p className="visit-meta">
                    {[location.type, location.region, location.territory]
                      .filter(Boolean)
                      .map((value) => formatLabel(String(value)))
                      .join(" · ") || "No segment details"}
                  </p>
                  {location.notes ? (
                    <p className="form-hint">{location.notes}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No locations are available yet.</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>Products</h2>
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
                          .join(" · ") || "No catalogue details"}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${statusTone(product.status)}`}
                    >
                      {formatLabel(product.status)}
                    </span>
                  </header>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No products are available yet.</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>My tasks</h2>
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
                          : "No location"}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${taskStatusTone(item.status)}`}
                    >
                      {formatLabel(item.status)}
                    </span>
                  </header>
                  <p className="visit-meta">
                    {item.description ?? "No additional details"}
                  </p>
                  <p className="form-hint">
                    {formatLabel(item.priority)} priority · Due{" "}
                    {formatDateTime(item.dueDate, "not set")}
                  </p>
                  <form
                    action={updateTaskStatusAction}
                    className="inline-control-form"
                  >
                    <input name="taskId" type="hidden" value={item.id} />
                    <select
                      aria-label={`Update ${item.title} status`}
                      defaultValue={item.status}
                      name="status"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <PendingSubmitButton
                      className="secondary-button"
                      pendingLabel="Saving..."
                    >
                      Save
                    </PendingSubmitButton>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No tasks assigned right now.</p>
          )}
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>FAQ</h2>
          </summary>
          <div className="faq-list">
            <details className="faq-item">
              <summary className="faq-question">
                What happens to voice notes before I record one?
              </summary>
              <p className="faq-answer">
                Voice notes may be transcribed and processed by AI for visit
                reports. Audio and transcripts are temporary processing data;
                the confirmed report is reviewed before it becomes official.
              </p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">
                What should I do when the AI draft is weak?
              </summary>
              <p className="faq-answer">
                Treat the draft as a suggestion. Edit the facts before
                confirmation or use the manual fallback when the output misses
                important context.
              </p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">
                What should I do when AI is unavailable?
              </summary>
              <p className="faq-answer">
                Save a text note and confirm the manual report. Failed
                transcription or extraction should not block the visit.
              </p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">
                What does &quot;AI processing can use visit notes&quot; mean on
                a visit card?
              </summary>
              <p className="faq-answer">
                Add a voice or text note. If transcription or extraction is
                delayed, use the manual fallback below the note fields.
              </p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">
                What does &quot;Draft requires review&quot; mean?
              </summary>
              <p className="faq-answer">
                Review the AI draft carefully before confirmation. Missing or
                uncertain fields should be corrected manually.
              </p>
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

function taskStatusTone(status: TaskStatus): string {
  if (status === "done") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}
