import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { FieldRecordingNotice } from "../../../components/field-recording-notice";
import { FieldVoiceNoteRecorder } from "../../../components/field-voice-note-recorder";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  addTextVisitNote,
  confirmManualReport,
  createVisit,
  getCurrentSession,
  listTodayRoutes,
  listVisits,
  updateRouteItem,
  type RoutePlan,
  type Visit,
  uploadAudioVisitNote,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

type FieldPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    audio?: string;
    note?: string;
    report?: string;
    route?: string;
    visit?: string;
    error?: string;
  }>;
};

type FieldRouteStop = {
  id: string;
  routePlanId: string;
  locationId: string;
  name: string;
  address: string;
  sequence: number;
  visited: boolean;
};

type FieldVisit = {
  id: string;
  name: string;
  address: string;
  status: string;
  next: string;
  canConfirm: boolean;
  aiQualityState:
    | "ready_to_confirm"
    | "processing"
    | "needs_review"
    | "manual_fallback_available"
    | "confirmed";
};

const demoVisits: FieldVisit[] = [
  {
    id: "demo-visit-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    status: "In progress",
    next: "Record shelf notes",
    canConfirm: false,
    aiQualityState: "processing",
  },
  {
    id: "demo-visit-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    status: "Planned",
    next: "Check service agreement",
    canConfirm: false,
    aiQualityState: "ready_to_confirm",
  },
  {
    id: "demo-visit-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    status: "Follow-up",
    next: "Confirm next order",
    canConfirm: false,
    aiQualityState: "manual_fallback_available",
  },
];

const demoRouteStops: FieldRouteStop[] = [
  {
    id: "demo-stop-1",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    sequence: 1,
    visited: true,
  },
  {
    id: "demo-stop-2",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    sequence: 2,
    visited: false,
  },
  {
    id: "demo-stop-3",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    sequence: 3,
    visited: false,
  },
];

export default async function FieldPage({
  params,
  searchParams,
}: FieldPageProps) {
  const { tenantSlug } = await params;
  const { audio, note, report, route, visit, error } = await searchParams;

  async function createVisitAction(formData: FormData) {
    "use server";

    const locationId = String(formData.get("locationId") ?? "").trim();
    const visitType = String(formData.get("visitType") ?? "").trim();
    const actionSessionResult = await getCurrentSession();

    if (!locationId || !visitType || !actionSessionResult.ok) {
      redirect(`/${tenantSlug}/field?error=visit`);
    }

    const result = await createVisit(
      locationId,
      actionSessionResult.data.user.id,
      visitType,
    );

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=visit`);
    }

    redirect(`/${tenantSlug}/field?visit=created`);
  }

  async function addTextNoteAction(formData: FormData) {
    "use server";

    const visitId = String(formData.get("visitId") ?? "").trim();
    const textContent = String(formData.get("textContent") ?? "").trim();

    if (!visitId || !textContent) {
      redirect(`/${tenantSlug}/field?error=note`);
    }

    const result = await addTextVisitNote(visitId, textContent);

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=note`);
    }

    redirect(`/${tenantSlug}/field?note=saved`);
  }

  async function uploadAudioNoteAction(formData: FormData) {
    "use server";

    const visitId = String(formData.get("visitId") ?? "").trim();
    const audioFile = formData.get("audioFile");

    if (!visitId || !(audioFile instanceof File) || audioFile.size === 0) {
      redirect(`/${tenantSlug}/field?error=audio`);
    }

    const result = await uploadAudioVisitNote(visitId, audioFile);

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=audio`);
    }

    redirect(`/${tenantSlug}/field?audio=uploaded`);
  }

  async function confirmReportAction(formData: FormData) {
    "use server";

    const visitId = String(formData.get("visitId") ?? "").trim();
    const summary = String(formData.get("summary") ?? "").trim();
    const nextSteps = String(formData.get("nextSteps") ?? "").trim();

    if (!visitId || !summary) {
      redirect(`/${tenantSlug}/field?error=report`);
    }

    const result = await confirmManualReport(visitId, {
      summary,
      ...(nextSteps ? { nextSteps } : {}),
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=report`);
    }

    redirect(`/${tenantSlug}/field?report=confirmed`);
  }

  async function markStopVisitedAction(formData: FormData) {
    "use server";

    const routePlanId = String(formData.get("routePlanId") ?? "").trim();
    const routeItemId = String(formData.get("routeItemId") ?? "").trim();

    if (!routePlanId || !routeItemId) {
      redirect(`/${tenantSlug}/field?error=route`);
    }

    const result = await updateRouteItem(routePlanId, routeItemId, {
      status: "visited",
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=route`);
    }

    redirect(`/${tenantSlug}/field?route=visited`);
  }

  const sessionResult = await getCurrentSession();
  const visitsResult = sessionResult.ok
    ? await listVisits()
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const todayRoutesResult = sessionResult.ok
    ? await listTodayRoutes()
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!visitsResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Today&apos;s visits</h1>
            <p>
              Live visit data is required in production before field work can
              continue.
            </p>
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
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.ok
    ? visitsResult.data.items.map(toFieldVisit)
    : demoVisits;
  const routeStops = todayRoutesResult.ok
    ? toRouteStops(todayRoutesResult.data)
    : demoRouteStops;
  const visitedStops = routeStops.filter((stop) => stop.visited).length;
  const isDemoMode = !visitsResult.ok && demoFallbackEnabled;
  const representativeName = sessionResult.ok
    ? sessionResult.data.user.name
    : "Demo representative";

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">Field flow</p>
          <h1>Today&apos;s visits</h1>
        </div>
        <div className="toolbar" aria-label="Visit actions">
          <button
            className="icon-button"
            disabled
            type="button"
            title="Refresh"
          >
            R
          </button>
          <a className="secondary-button" href={`/${tenantSlug}/field/history`}>
            History
          </a>
        </div>
      </header>

      <FieldRecordingNotice tenantSlug={tenantSlug} />

      {audio === "uploaded" ? (
        <section className="notice-panel success" aria-label="Audio status">
          <div>
            <p className="eyebrow">Voice note uploaded</p>
            <h2>Audio attached</h2>
            <p>
              The voice note is attached for processing. You can continue with a
              text note or confirm the manual fallback if the visit is ready.
            </p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#voice-notes">
              Add another note
            </a>
            <a className="primary-button" href="#voice-notes">
              Confirm report
            </a>
          </div>
        </section>
      ) : null}

      {note === "saved" ? (
        <section className="notice-panel success" aria-label="Note status">
          <div>
            <p className="eyebrow">Note saved</p>
            <h2>Text note added</h2>
            <p>The note was attached to the visit.</p>
          </div>
        </section>
      ) : null}

      {report === "confirmed" ? (
        <section className="notice-panel success" aria-label="Report status">
          <div>
            <p className="eyebrow">Report confirmed</p>
            <h2>Manual report saved</h2>
            <p>The visit was marked completed and the report was confirmed.</p>
          </div>
        </section>
      ) : null}

      {visit === "created" ? (
        <section className="notice-panel success" aria-label="Visit status">
          <div>
            <p className="eyebrow">Visit started</p>
            <h2>New visit created</h2>
            <p>The visit is ready for notes and report confirmation.</p>
          </div>
        </section>
      ) : null}

      {route === "visited" ? (
        <section className="notice-panel success" aria-label="Route status">
          <div>
            <p className="eyebrow">Route updated</p>
            <h2>Stop marked as visited</h2>
            <p>Your route progress for today was updated.</p>
          </div>
        </section>
      ) : null}

      {error === "audio" ? (
        <section className="notice-panel danger" aria-label="Audio error">
          <div>
            <p className="eyebrow">Voice note not uploaded</p>
            <h2>Audio upload failed</h2>
            <p>
              Choose a supported audio file up to 50 MB, record again or save a
              text note so the visit can still be completed.
            </p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#voice-notes">
              Try audio again
            </a>
            <a className="primary-button" href="#voice-notes">
              Use manual fallback
            </a>
          </div>
        </section>
      ) : null}

      {error === "note" ? (
        <section className="notice-panel danger" aria-label="Note error">
          <div>
            <p className="eyebrow">Note not saved</p>
            <h2>Text note failed</h2>
            <p>Add note text and try again.</p>
          </div>
        </section>
      ) : null}

      {error === "report" ? (
        <section className="notice-panel danger" aria-label="Report error">
          <div>
            <p className="eyebrow">Report not saved</p>
            <h2>Manual report confirmation failed</h2>
            <p>Add a short summary and try again.</p>
          </div>
        </section>
      ) : null}

      {error === "visit" ? (
        <section className="notice-panel danger" aria-label="Visit error">
          <div>
            <p className="eyebrow">Visit not created</p>
            <h2>New visit failed</h2>
            <p>Select an active location and try again.</p>
          </div>
        </section>
      ) : null}

      {error === "route" ? (
        <section className="notice-panel danger" aria-label="Route error">
          <div>
            <p className="eyebrow">Route not updated</p>
            <h2>Could not update the stop</h2>
            <p>Refresh your field workspace and try again.</p>
          </div>
        </section>
      ) : null}

      {isDemoMode ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Backend session is not connected</h2>
            <p>
              Showing sample visits until the Nest API returns an authenticated
              session. Reason: {visitsResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <section className="route-section" aria-label="Today's route">
        {routeStops.length > 0 ? (
          <>
            <article className="route-progress-card">
              <div className="route-progress-head">
                <span>Progress today</span>
                <span className="route-progress-count">
                  {visitedStops}/{routeStops.length}
                </span>
              </div>
              <div
                className="route-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={routeStops.length}
                aria-valuenow={visitedStops}
              >
                <div
                  className="route-progress-fill"
                  style={{
                    width: `${Math.round(
                      (visitedStops / routeStops.length) * 100,
                    )}%`,
                  }}
                />
              </div>
              <div className="route-progress-legend">
                <span>{visitedStops} visited</span>
                {routeStops.length - visitedStops > 0 ? (
                  <span>{routeStops.length - visitedStops} remaining</span>
                ) : (
                  <span>All visited</span>
                )}
              </div>
            </article>

            <div className="route-plan-card">
              <div className="route-plan-head">
                <span className="route-plan-icon" aria-hidden="true">
                  ⇄
                </span>
                <div className="route-plan-heading">
                  <p className="route-plan-name">Today&apos;s route</p>
                  <a
                    className="route-plan-link"
                    href={`/${tenantSlug}/field/planning`}
                  >
                    Edit plan →
                  </a>
                </div>
              </div>

              <ol className="route-stop-list">
                {routeStops.map((stop, index) => (
                  <li key={stop.id}>
                    <details
                      className={`route-stop${stop.visited ? " visited" : ""}`}
                    >
                      <summary className="route-stop-summary">
                        <span className="route-stop-index" aria-hidden="true">
                          {stop.visited ? "✓" : index + 1}
                        </span>
                        <div className="route-stop-body">
                          <h3>{stop.name}</h3>
                          <p className="route-stop-address">{stop.address}</p>
                        </div>
                        <span
                          className="route-stop-chevron"
                          aria-hidden="true"
                        >
                          ›
                        </span>
                      </summary>
                      <div className="route-stop-detail">
                        <span
                          className={`status-pill ${
                            stop.visited ? "active" : "info"
                          }`}
                        >
                          {stop.visited ? "Visited" : "Planned"}
                        </span>
                        {stop.visited ? null : (
                          <div className="route-stop-actions">
                            <form action={createVisitAction}>
                              <input
                                name="locationId"
                                type="hidden"
                                value={stop.locationId}
                              />
                              <input
                                name="visitType"
                                type="hidden"
                                value="field_visit"
                              />
                              <PendingSubmitButton
                                className="primary-button"
                                pendingLabel="Starting..."
                              >
                                Start visit
                              </PendingSubmitButton>
                            </form>
                            <form action={markStopVisitedAction}>
                              <input
                                name="routePlanId"
                                type="hidden"
                                value={stop.routePlanId}
                              />
                              <input
                                name="routeItemId"
                                type="hidden"
                                value={stop.id}
                              />
                              <PendingSubmitButton
                                className="secondary-button"
                                pendingLabel="Saving..."
                              >
                                Mark visited
                              </PendingSubmitButton>
                            </form>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : (
          <div className="route-empty">
            <p className="route-empty-title">No route planned for today</p>
            <p className="route-empty-text">
              Build a route in planning to line up today&apos;s stops in order.
            </p>
            <a
              className="route-plan-link"
              href={`/${tenantSlug}/field/planning`}
            >
              Go to planning →
            </a>
          </div>
        )}
      </section>

      <section className="field-visits" aria-label="Visits in progress">
        <div className="field-stack" id="voice-notes">
          {visits.length > 0 ? (
            visits.map((visit, index) => (
              <article className="visit-card" key={visit.id}>
                <header>
                  <div>
                    <h2>{visit.name}</h2>
                    <p className="visit-meta">{visit.address}</p>
                  </div>
                  <span
                    className={`status-pill ${resolveStatusTone(
                      visit.status,
                      index,
                    )}`}
                  >
                    {visit.status}
                  </span>
                </header>
                <p className="visit-meta">{visit.next}</p>
                <AiQualityStatePanel visit={visit} />
                {visit.canConfirm ? (
                  <form action={addTextNoteAction} className="visit-form">
                    <input name="visitId" type="hidden" value={visit.id} />
                    <label>
                      Text note
                      <textarea
                        name="textContent"
                        placeholder="Add shelf notes, agreements or observations"
                        required
                        rows={2}
                      />
                    </label>
                    <PendingSubmitButton
                      className="secondary-button"
                      pendingLabel="Saving note..."
                    >
                      Save note
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {visit.canConfirm ? (
                  <form action={uploadAudioNoteAction} className="visit-form">
                    <input name="visitId" type="hidden" value={visit.id} />
                    <label>
                      Voice note
                      <FieldVoiceNoteRecorder inputName="audioFile" />
                    </label>
                    <PendingSubmitButton
                      className="secondary-button"
                      pendingLabel="Uploading..."
                    >
                      Upload voice note
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {visit.canConfirm ? (
                  <form action={confirmReportAction} className="visit-form">
                    <input name="visitId" type="hidden" value={visit.id} />
                    <label>
                      Visit summary
                      <textarea
                        name="summary"
                        placeholder="What happened during this visit?"
                        required
                        rows={3}
                      />
                    </label>
                    <label>
                      Next steps
                      <textarea
                        name="nextSteps"
                        placeholder="Optional follow-up, blockers or tasks"
                        rows={2}
                      />
                    </label>
                    <PendingSubmitButton
                      className="primary-button"
                      pendingLabel="Confirming..."
                    >
                      Confirm manual fallback
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </article>
            ))
          ) : (
            <section className="empty-state-panel">
              <h2>No visits yet</h2>
              <p>
                Open a stop on today&apos;s route and start a visit to begin
                capturing notes and report confirmation.
              </p>
            </section>
          )}
        </div>

      </section>
    </AppShell>
  );
}

function toRouteStops(plans: RoutePlan[]): FieldRouteStop[] {
  return plans
    .flatMap((plan) =>
      plan.items
        .filter((item) => item.status !== "skipped")
        .map((item) => ({
          id: item.id,
          routePlanId: plan.id,
          locationId: item.locationId,
          name: item.location.name,
          address: [item.location.addressLine, item.location.city]
            .filter(Boolean)
            .join(", "),
          sequence: item.sequence,
          visited: item.status === "visited",
        })),
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function toFieldVisit(visit: Visit): FieldVisit {
  return {
    id: visit.id,
    name: visit.location.name,
    address: [visit.location.addressLine, visit.location.city]
      .filter(Boolean)
      .join(", "),
    status: formatVisitStatus(visit.status),
    next:
      visit.status === "completed"
        ? "Review confirmed report"
        : visit.status === "cancelled"
          ? "Route item cancelled"
          : "Add note and confirm report",
    canConfirm: visit.status !== "completed" && visit.status !== "cancelled",
    aiQualityState:
      visit.status === "completed"
        ? "confirmed"
        : visit.status === "in_progress"
          ? "processing"
          : "ready_to_confirm",
  };
}

function AiQualityStatePanel({ visit }: { visit: FieldVisit }) {
  const state = resolveAiQualityState(visit.aiQualityState);

  return (
    <section className={`ai-draft-state ${state.tone}`}>
      <div>
        <p className="eyebrow">AI quality</p>
        <h3>{state.title}</h3>
        <p>{state.detail}</p>
      </div>
      <span className={`status-pill ${state.badgeTone}`}>{state.label}</span>
    </section>
  );
}

function resolveAiQualityState(state: FieldVisit["aiQualityState"]): {
  badgeTone: "active" | "info" | "warning";
  detail: string;
  label: string;
  title: string;
  tone: "ready" | "processing" | "needs-review" | "fallback" | "confirmed";
} {
  switch (state) {
    case "confirmed":
      return {
        badgeTone: "active",
        detail:
          "The visit is completed. Review the final report from manager views.",
        label: "Confirmed",
        title: "Final report saved",
        tone: "confirmed",
      };
    case "processing":
      return {
        badgeTone: "info",
        detail:
          "Add a voice or text note. If transcription or extraction is delayed, use the manual fallback below.",
        label: "Processing",
        title: "AI processing can use visit notes",
        tone: "processing",
      };
    case "needs_review":
      return {
        badgeTone: "warning",
        detail:
          "Review the draft carefully before confirmation. Missing or uncertain fields should be corrected manually.",
        label: "Needs review",
        title: "Draft requires review",
        tone: "needs-review",
      };
    case "manual_fallback_available":
      return {
        badgeTone: "warning",
        detail:
          "AI output may be incomplete for this visit. Confirm the report manually if the draft is weak or unavailable.",
        label: "Manual fallback",
        title: "Manual confirmation is available",
        tone: "fallback",
      };
    case "ready_to_confirm":
      return {
        badgeTone: "info",
        detail:
          "Start the visit and add text or audio notes before confirming a final report.",
        label: "Ready",
        title: "Waiting for visit notes",
        tone: "ready",
      };
  }
}

function formatVisitStatus(status: Visit["status"]): string {
  return status
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function resolveStatusTone(status: string, index: number): string {
  if (status === "Completed") {
    return "active";
  }

  if (status === "Cancelled") {
    return "warning";
  }

  return index === 1 ? "info" : "warning";
}
