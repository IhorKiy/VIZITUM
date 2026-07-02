import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { FieldRecordingNotice } from "../../../components/field-recording-notice";
import {
  addTextVisitNote,
  confirmManualReport,
  getCurrentSession,
  listVisits,
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
};

const demoVisits: FieldVisit[] = [
  {
    id: "demo-visit-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    status: "In progress",
    next: "Record shelf notes",
    canConfirm: false,
  },
  {
    id: "demo-visit-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    status: "Planned",
    next: "Check service agreement",
    canConfirm: false,
  },
  {
    id: "demo-visit-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    status: "Follow-up",
    next: "Confirm next order",
    canConfirm: false,
  },
];

export default async function FieldPage({
  params,
  searchParams,
}: FieldPageProps) {
  const { tenantSlug } = await params;
  const { audio, note, report, error } = await searchParams;

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

  const sessionResult = await getCurrentSession();
  const visitsResult = sessionResult.ok
    ? await listVisits()
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

  const visits =
    visitsResult.ok && visitsResult.data.items.length > 0
      ? visitsResult.data.items.map(toFieldVisit)
      : demoVisits;
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
          <button className="primary-button" disabled type="button">
            New visit
          </button>
        </div>
      </header>

      <FieldRecordingNotice tenantSlug={tenantSlug} />

      {audio === "uploaded" ? (
        <section className="notice-panel success" aria-label="Audio status">
          <div>
            <p className="eyebrow">Voice note uploaded</p>
            <h2>Audio attached</h2>
            <p>The temporary voice note was uploaded for processing.</p>
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

      {error === "audio" ? (
        <section className="notice-panel danger" aria-label="Audio error">
          <div>
            <p className="eyebrow">Voice note not uploaded</p>
            <h2>Audio upload failed</h2>
            <p>Choose a supported audio file up to 50 MB and try again.</p>
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
        <div className="field-stack">
          {visits.map((visit, index) => (
            <article className="visit-card" key={visit.name}>
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
                  <button className="secondary-button" type="submit">
                    Save note
                  </button>
                </form>
              ) : null}
              {visit.canConfirm ? (
                <form action={uploadAudioNoteAction} className="visit-form">
                  <input name="visitId" type="hidden" value={visit.id} />
                  <label>
                    Voice note
                    <input
                      accept="audio/webm,audio/mp4,audio/aac,audio/mpeg,audio/wav,.m4a,.mp3,.wav,.webm"
                      name="audioFile"
                      required
                      type="file"
                    />
                  </label>
                  <button className="secondary-button" type="submit">
                    Upload voice note
                  </button>
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
                  <button className="primary-button" type="submit">
                    Confirm report
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>

        <aside className="panel" aria-labelledby="field-summary-title">
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
                <th scope="row">Reports waiting</th>
                <td>2</td>
              </tr>
              <tr>
                <th scope="row">AI drafts</th>
                <td>1</td>
              </tr>
            </tbody>
          </table>
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
