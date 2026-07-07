import { redirect } from "next/navigation";

import { AppShell } from "../../../../../components/app-shell";
import { FieldVoiceNoteRecorder } from "../../../../../components/field-voice-note-recorder";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  addTextVisitNote,
  confirmManualReport,
  getCurrentSession,
  getVisit,
  uploadAudioVisitNote,
  type Visit,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import { formatLabel, statusPillTone } from "../../../../../lib/format";

type VisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
  searchParams: Promise<{
    audio?: string;
    note?: string;
    error?: string;
    demoName?: string;
    demoAddress?: string;
  }>;
};

type FieldVisit = {
  id: string;
  locationId: string;
  name: string;
  address: string;
  status: string;
  statusTone: "active" | "info" | "warning";
  next: string;
  canConfirm: boolean;
  aiQualityState:
    | "ready_to_confirm"
    | "processing"
    | "needs_review"
    | "manual_fallback_available"
    | "confirmed";
};

export default async function VisitDetailPage({
  params,
  searchParams,
}: VisitDetailPageProps) {
  const { tenantSlug, visitId } = await params;
  const { audio, note, error, demoName, demoAddress } = await searchParams;

  async function addTextNoteAction(formData: FormData) {
    "use server";

    const textContent = String(formData.get("textContent") ?? "").trim();

    if (!textContent) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=note`);
    }

    const result = await addTextVisitNote(visitId, textContent);

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=note`);
    }

    redirect(`/${tenantSlug}/field/visits/${visitId}?note=saved`);
  }

  async function uploadAudioNoteAction(formData: FormData) {
    "use server";

    const audioFile = formData.get("audioFile");

    if (!(audioFile instanceof File) || audioFile.size === 0) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=audio`);
    }

    const result = await uploadAudioVisitNote(visitId, audioFile);

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=audio`);
    }

    redirect(`/${tenantSlug}/field/visits/${visitId}?audio=uploaded`);
  }

  async function confirmReportAction(formData: FormData) {
    "use server";

    const summary = String(formData.get("summary") ?? "").trim();
    const nextSteps = String(formData.get("nextSteps") ?? "").trim();

    if (!summary) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=report`);
    }

    const result = await confirmManualReport(visitId, {
      summary,
      ...(nextSteps ? { nextSteps } : {}),
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/visits/${visitId}?error=report`);
    }

    redirect(`/${tenantSlug}/field?report=confirmed`);
  }

  const [sessionResult, visitResult] = await Promise.all([
    getCurrentSession(),
    getVisit(visitId),
  ]);

  const demoFallbackEnabled = isDemoFallbackEnabled();
  const isDemoVisit =
    !sessionResult.ok && demoFallbackEnabled && visitId.startsWith("demo-visit-");

  if (!sessionResult.ok && !isDemoVisit) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Visit</h1>
            <p>Sign in to view this visit.</p>
          </div>
          <div className="toolbar" aria-label="Session actions">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>
      </AppShell>
    );
  }

  if (!isDemoVisit && !visitResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Visit not found</h1>
          </div>
          <div className="toolbar" aria-label="Visit actions">
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              Back to route
            </a>
          </div>
        </header>
        <section className="notice-panel danger" aria-label="Visit error">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Could not load this visit</h2>
            <p>{visitResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visit = isDemoVisit
    ? toDemoFieldVisit(visitId, demoName, demoAddress)
    : visitResult.ok
      ? toFieldVisit(visitResult.data)
      : toDemoFieldVisit(visitId, demoName, demoAddress);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">Visit</p>
          <h1>{visit.name}</h1>
          <p>{visit.address}</p>
        </div>
        <div className="toolbar" aria-label="Visit actions">
          <a
            className="secondary-button"
            href={`/${tenantSlug}/field/locations/${visit.locationId}${
              isDemoVisit
                ? `?demoName=${encodeURIComponent(visit.name)}&demoAddress=${encodeURIComponent(visit.address)}`
                : ""
            }`}
          >
            Back to location
          </a>
        </div>
      </header>

      {isDemoVisit ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Backend session is not connected</h2>
            <p>
              This is a sample visit. Notes, audio and report confirmation
              require a live backend session and are disabled here.
            </p>
          </div>
        </section>
      ) : null}

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

      <article className="visit-card">
        <header>
          <div>
            <h2>{visit.name}</h2>
            <p className="visit-meta">{visit.address}</p>
          </div>
          <span className={`status-pill ${visit.statusTone}`}>
            {visit.status}
          </span>
        </header>
        <p className="visit-meta">{visit.next}</p>
        <AiQualityStatePanel visit={visit} />
        {visit.canConfirm ? (
          <form action={addTextNoteAction} className="visit-form">
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
    </AppShell>
  );
}

function toFieldVisit(visit: Visit): FieldVisit {
  return {
    id: visit.id,
    locationId: visit.locationId,
    name: visit.location.name,
    address: [visit.location.addressLine, visit.location.city]
      .filter(Boolean)
      .join(", "),
    status: formatLabel(visit.status),
    statusTone: statusPillTone(visit.status),
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

function toDemoFieldVisit(
  visitId: string,
  demoName: string | undefined,
  demoAddress: string | undefined,
): FieldVisit {
  return {
    id: visitId,
    locationId: visitId.replace(/^demo-visit-/, ""),
    name: demoName ?? "Demo location",
    address: demoAddress ?? "",
    status: "Demo",
    statusTone: "info",
    next: "Sign in to record notes and confirm a report.",
    canConfirm: false,
    aiQualityState: "ready_to_confirm",
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
