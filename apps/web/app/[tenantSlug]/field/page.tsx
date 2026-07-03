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
  listLocations,
  listTasks,
  listVisits,
  updateTask,
  type Location,
  type Task,
  type TaskStatus,
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
    task?: string;
    visit?: string;
    error?: string;
  }>;
};

type FieldVisit = {
  id: string;
  name: string;
  address: string;
  status: string;
  next: string;
  canConfirm: boolean;
  aiDraftState:
    "ready_for_notes" | "processing" | "manual_fallback" | "confirmed";
};

type FieldLocation = {
  id: string;
  name: string;
  address: string;
  detail: string;
  notes: string | null;
  status: string;
};

type FieldTask = {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: string;
  dueDate: string;
  locationName: string;
};

const demoVisits: FieldVisit[] = [
  {
    id: "demo-visit-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    status: "In progress",
    next: "Record shelf notes",
    canConfirm: false,
    aiDraftState: "ready_for_notes",
  },
  {
    id: "demo-visit-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    status: "Planned",
    next: "Check service agreement",
    canConfirm: false,
    aiDraftState: "ready_for_notes",
  },
  {
    id: "demo-visit-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    status: "Follow-up",
    next: "Confirm next order",
    canConfirm: false,
    aiDraftState: "manual_fallback",
  },
];

const demoLocations: FieldLocation[] = [
  {
    id: "demo-location-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    detail: "Trade · Kyiv North",
    notes: "Check shelf share and competitor pricing.",
    status: "Active",
  },
  {
    id: "demo-location-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    detail: "Pharmacy · Kyiv Center",
    notes: "Service agreement renewal due this month.",
    status: "Active",
  },
  {
    id: "demo-location-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    detail: "Partner · Kyiv West",
    notes: null,
    status: "Active",
  },
];

const demoTasks: FieldTask[] = [
  {
    id: "demo-task-1",
    title: "Confirm promo display",
    detail: "Take a quick note after checking shelf visibility.",
    status: "open",
    priority: "High",
    dueDate: "Today",
    locationName: "Silpo Obolon",
  },
  {
    id: "demo-task-2",
    title: "Ask about next order",
    detail: "Capture the partner's expected reorder date.",
    status: "in_progress",
    priority: "Normal",
    dueDate: "Tomorrow",
    locationName: "Partner Hub",
  },
];

export default async function FieldPage({
  params,
  searchParams,
}: FieldPageProps) {
  const { tenantSlug } = await params;
  const { audio, note, report, task, visit, error } = await searchParams;

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

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    const taskId = String(formData.get("taskId") ?? "").trim();
    const status = normalizeTaskStatus(formData.get("status"));

    if (!taskId || !status) {
      redirect(`/${tenantSlug}/field?error=task`);
    }

    const result = await updateTask(taskId, { status });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field?error=task`);
    }

    redirect(`/${tenantSlug}/field?task=updated`);
  }

  const sessionResult = await getCurrentSession();
  const visitsResult = sessionResult.ok
    ? await listVisits()
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const locationsResult = sessionResult.ok
    ? await listLocations()
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const tasksResult = sessionResult.ok
    ? await listTasks("pageSize=50")
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
  const locations = locationsResult.ok
    ? locationsResult.data.items.map(toFieldLocation)
    : demoLocations;
  const tasks = tasksResult.ok
    ? tasksResult.data.items.map(toFieldTask)
    : demoTasks;
  const isDemoMode = !visitsResult.ok && demoFallbackEnabled;
  const canCreateLiveVisit = locationsResult.ok && locations.length > 0;
  const representativeName = sessionResult.ok
    ? sessionResult.data.user.name
    : "Demo representative";
  const openTasks = tasks.filter(
    (item) => item.status === "open" || item.status === "in_progress",
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">Field flow</p>
          <h1>Today&apos;s visits</h1>
          <p>
            {representativeName} has a mobile-first workspace for route
            execution, voice notes and manual report confirmation.
          </p>
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
          <a className="primary-button" href="#new-visit">
            New visit
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

      {task === "updated" ? (
        <section className="notice-panel success" aria-label="Task status">
          <div>
            <p className="eyebrow">Task updated</p>
            <h2>Follow-up saved</h2>
            <p>The task status was updated for your field queue.</p>
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

      {error === "task" ? (
        <section className="notice-panel danger" aria-label="Task error">
          <div>
            <p className="eyebrow">Task not updated</p>
            <h2>Follow-up update failed</h2>
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

      <section className="dashboard-grid" aria-label="Field workspace">
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
                <AiDraftStatePanel visit={visit} />
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
                Start a visit from an active location to begin capturing notes
                and report confirmation.
              </p>
              <a className="primary-button" href="#new-visit">
                New visit
              </a>
            </section>
          )}
        </div>

        <aside className="panel" aria-labelledby="field-summary-title">
          <section id="new-visit" className="field-panel-section">
            <h2>New visit</h2>
            {canCreateLiveVisit ? (
              <form action={createVisitAction} className="visit-form compact">
                <label>
                  Location
                  <select name="locationId" required>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} · {location.address}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Visit type
                  <select name="visitType" required>
                    <option value="field_visit">Field visit</option>
                    <option value="service_visit">Service visit</option>
                    <option value="partner_check_in">Partner check-in</option>
                  </select>
                </label>
                <PendingSubmitButton
                  className="primary-button"
                  pendingLabel="Starting..."
                >
                  Start visit
                </PendingSubmitButton>
              </form>
            ) : (
              <p className="empty-state">
                Active locations are required before starting a live visit.
              </p>
            )}
          </section>

          <h2 id="field-summary-title">Route summary</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Completed</th>
                <td>
                  {
                    visits.filter((visit) => visit.status === "Completed")
                      .length
                  }
                </td>
              </tr>
              <tr>
                <th scope="row">Remaining</th>
                <td>
                  {
                    visits.filter((visit) => visit.status !== "Completed")
                      .length
                  }
                </td>
              </tr>
              <tr>
                <th scope="row">Open tasks</th>
                <td>{openTasks.length}</td>
              </tr>
              <tr>
                <th scope="row">Locations</th>
                <td>{locations.length}</td>
              </tr>
            </tbody>
          </table>

          <section className="field-panel-section">
            <h2>Location cards</h2>
            {locations.length > 0 ? (
              <div className="field-card-list">
                {locations.slice(0, 4).map((location) => (
                  <article className="location-mini-card" key={location.id}>
                    <header>
                      <div>
                        <h3>{location.name}</h3>
                        <p>{location.address}</p>
                      </div>
                      <span className="status-pill active">
                        {location.status}
                      </span>
                    </header>
                    <p className="visit-meta">{location.detail}</p>
                    {location.notes ? (
                      <p className="form-hint">{location.notes}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No active locations are available for field work yet.
              </p>
            )}
          </section>

          <section>
            <h2>My tasks</h2>
            {openTasks.length > 0 ? (
              <div className="field-card-list">
                {openTasks.map((item) => (
                  <article className="location-mini-card" key={item.id}>
                    <header>
                      <div>
                        <h3>{item.title}</h3>
                        <p>{item.locationName}</p>
                      </div>
                      <span
                        className={`status-pill ${taskStatusTone(item.status)}`}
                      >
                        {formatTaskStatus(item.status)}
                      </span>
                    </header>
                    <p className="visit-meta">{item.detail}</p>
                    <p className="form-hint">
                      {item.priority} priority · Due {item.dueDate}
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
          </section>

          <section className="field-ai-guidance">
            <h2>AI draft guidance</h2>
            <div className="field-card-list">
              <article className="location-mini-card">
                <h3>When AI is weak</h3>
                <p className="visit-meta">
                  Treat the draft as a suggestion. Edit the facts before
                  confirmation or use the manual fallback when the output misses
                  important context.
                </p>
              </article>
              <article className="location-mini-card">
                <h3>When AI is unavailable</h3>
                <p className="visit-meta">
                  Save a text note and confirm the manual report. Failed
                  transcription or extraction should not block the visit.
                </p>
              </article>
            </div>
          </section>
        </aside>
      </section>
    </AppShell>
  );
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
    aiDraftState:
      visit.status === "completed"
        ? "confirmed"
        : visit.status === "in_progress"
          ? "processing"
          : "ready_for_notes",
  };
}

function AiDraftStatePanel({ visit }: { visit: FieldVisit }) {
  const state = resolveAiDraftState(visit.aiDraftState);

  return (
    <section className={`ai-draft-state ${state.tone}`}>
      <div>
        <p className="eyebrow">AI draft</p>
        <h3>{state.title}</h3>
        <p>{state.detail}</p>
      </div>
      <span className={`status-pill ${state.badgeTone}`}>{state.label}</span>
    </section>
  );
}

function resolveAiDraftState(state: FieldVisit["aiDraftState"]): {
  badgeTone: "active" | "info" | "warning";
  detail: string;
  label: string;
  title: string;
  tone: "ready" | "processing" | "fallback" | "confirmed";
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
        label: "In progress",
        title: "Draft can be generated from notes",
        tone: "processing",
      };
    case "manual_fallback":
      return {
        badgeTone: "warning",
        detail:
          "AI output may be incomplete for this visit. Confirm the report manually if the draft is weak or unavailable.",
        label: "Fallback",
        title: "Manual confirmation is available",
        tone: "fallback",
      };
    case "ready_for_notes":
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

function toFieldLocation(location: Location): FieldLocation {
  return {
    id: location.id,
    name: location.name,
    address: [location.addressLine, location.city].filter(Boolean).join(", "),
    detail: [location.type, location.region, location.territory]
      .filter(Boolean)
      .join(" · "),
    notes: location.notes,
    status: formatLabel(location.status),
  };
}

function toFieldTask(task: Task): FieldTask {
  return {
    id: task.id,
    title: task.title,
    detail: task.description ?? "No additional details",
    status: task.status,
    priority: formatLabel(task.priority),
    dueDate: formatDate(task.dueDate),
    locationName: task.locationId ? "Linked location" : "No location",
  };
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

function formatTaskStatus(status: TaskStatus): string {
  return formatLabel(status);
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

function formatDate(value: string | null): string {
  if (!value) {
    return "not set";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
