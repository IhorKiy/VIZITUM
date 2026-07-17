import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
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
import {
  formatEnumLabel,
  statusPillTone,
  type CommonTranslator,
} from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";

type VisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
  searchParams: Promise<{
    audio?: string;
    note?: string;
    error?: string;
    demoName?: string;
    demoAddress?: string;
    demoLocationId?: string;
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
  const { audio, note, error, demoName, demoAddress, demoLocationId } =
    await searchParams;
  const [t, tField, tCommon] = await Promise.all([
    getTranslations("field.visit"),
    getTranslations("field"),
    getTranslations("common"),
  ]);

  async function addTextNoteAction(formData: FormData) {
    "use server";

    const textContent = getFormString(formData, "textContent").trim();

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

    const summary = getFormString(formData, "summary").trim();
    const nextSteps = getFormString(formData, "nextSteps").trim();

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
    !sessionResult.ok &&
    demoFallbackEnabled &&
    visitId.startsWith("demo-visit-");

  if (!sessionResult.ok && !isDemoVisit) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("signedOutTitle")}</h1>
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
      </AppShell>
    );
  }

  if (!isDemoVisit && !visitResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("notFoundTitle")}</h1>
          </div>
          <div className="toolbar" aria-label={t("visitActions")}>
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              {tField("backToRoute")}
            </a>
          </div>
        </header>
        <section
          className="notice-panel danger"
          aria-label={t("visitErrorAria")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("loadErrorTitle")}</h2>
            <p>{visitResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visit = visitResult.ok
    ? toFieldVisit(visitResult.data, t, tCommon)
    : toDemoFieldVisit(visitId, t, demoLocationId, demoName, demoAddress);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{visit.name}</h1>
          <p>{visit.address}</p>
        </div>
        <div className="toolbar" aria-label={t("visitActions")}>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/field/locations/${visit.locationId}${
              isDemoVisit
                ? `?demoName=${encodeURIComponent(visit.name)}&demoAddress=${encodeURIComponent(visit.address)}`
                : ""
            }`}
          >
            {t("backToLocation")}
          </a>
        </div>
      </header>

      {isDemoVisit ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{t("demoBody")}</p>
          </div>
        </section>
      ) : null}

      {audio === "uploaded" ? (
        <DismissableNotice
          ariaLabel={t("audioStatusAria")}
          body={t("audioUploadedBody")}
          clearParams={["audio"]}
          eyebrow={t("audioUploadedEyebrow")}
          title={t("audioUploadedTitle")}
          tone="success"
        />
      ) : null}

      {note === "saved" ? (
        <DismissableNotice
          ariaLabel={t("noteStatusAria")}
          body={t("noteSavedBody")}
          clearParams={["note"]}
          eyebrow={t("noteSavedEyebrow")}
          title={t("noteSavedTitle")}
          tone="success"
        />
      ) : null}

      {error === "audio" ? (
        <DismissableNotice
          ariaLabel={t("audioErrorAria")}
          body={t("audioErrorBody")}
          clearParams={["error"]}
          eyebrow={t("audioErrorEyebrow")}
          title={t("audioErrorTitle")}
          tone="danger"
        />
      ) : null}

      {error === "note" ? (
        <DismissableNotice
          ariaLabel={t("noteErrorAria")}
          body={t("noteErrorBody")}
          clearParams={["error"]}
          eyebrow={t("noteErrorEyebrow")}
          title={t("noteErrorTitle")}
          tone="danger"
        />
      ) : null}

      {error === "report" ? (
        <DismissableNotice
          ariaLabel={t("reportErrorAria")}
          body={t("reportErrorBody")}
          clearParams={["error"]}
          eyebrow={t("reportErrorEyebrow")}
          title={t("reportErrorTitle")}
          tone="danger"
        />
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
              {t("textNote")}
              <textarea
                name="textContent"
                placeholder={t("textNotePlaceholder")}
                required
                rows={2}
              />
            </label>
            <PendingSubmitButton
              className="secondary-button"
              pendingLabel={t("savingNote")}
            >
              {t("saveNote")}
            </PendingSubmitButton>
          </form>
        ) : null}
        {visit.canConfirm ? (
          <form action={uploadAudioNoteAction} className="visit-form">
            <label>
              {t("voiceNote")}
              <FieldVoiceNoteRecorder inputName="audioFile" />
            </label>
            <PendingSubmitButton
              className="secondary-button"
              pendingLabel={t("uploading")}
            >
              {t("uploadVoiceNote")}
            </PendingSubmitButton>
          </form>
        ) : null}
        {visit.canConfirm ? (
          <form action={confirmReportAction} className="visit-form">
            <label>
              {t("visitSummary")}
              <textarea
                name="summary"
                placeholder={t("visitSummaryPlaceholder")}
                required
                rows={3}
              />
            </label>
            <label>
              {t("nextSteps")}
              <textarea
                name="nextSteps"
                placeholder={t("nextStepsPlaceholder")}
                rows={2}
              />
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("confirming")}
            >
              {t("confirmManualFallback")}
            </PendingSubmitButton>
          </form>
        ) : null}
      </article>
    </AppShell>
  );
}

type VisitTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.visit">>
>;

function toFieldVisit(
  visit: Visit,
  t: VisitTranslator,
  tCommon: CommonTranslator,
): FieldVisit {
  return {
    id: visit.id,
    locationId: visit.locationId,
    name: visit.location.name,
    address: [visit.location.addressLine, visit.location.city]
      .filter(Boolean)
      .join(", "),
    status: formatEnumLabel(tCommon, visit.status),
    statusTone: statusPillTone(visit.status),
    next:
      visit.status === "completed"
        ? t("nextCompleted")
        : visit.status === "cancelled"
          ? t("nextCancelled")
          : t("nextDefault"),
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
  t: VisitTranslator,
  demoLocationId: string | undefined,
  demoName: string | undefined,
  demoAddress: string | undefined,
): FieldVisit {
  return {
    id: visitId,
    locationId: demoLocationId ?? "",
    name: demoName ?? t("demoStatus"),
    address: demoAddress ?? "",
    status: t("demoStatus"),
    statusTone: "info",
    next: t("demoNext"),
    canConfirm: false,
    aiQualityState: "ready_to_confirm",
  };
}

function AiQualityStatePanel({ visit }: { visit: FieldVisit }) {
  const t = useTranslations("field.visit");
  const state = resolveAiQualityState(visit.aiQualityState);

  return (
    <section className={`ai-draft-state ${state.tone}`}>
      <div>
        <p className="eyebrow">{t("aiQualityEyebrow")}</p>
        <h3>{t(`ai.${state.key}.title`)}</h3>
        <p>{t(`ai.${state.key}.detail`)}</p>
      </div>
      <span className={`status-pill ${state.badgeTone}`}>
        {t(`ai.${state.key}.label`)}
      </span>
    </section>
  );
}

function resolveAiQualityState(state: FieldVisit["aiQualityState"]): {
  badgeTone: "active" | "info" | "warning";
  key: "confirmed" | "processing" | "needsReview" | "manualFallback" | "ready";
  tone: "ready" | "processing" | "needs-review" | "fallback" | "confirmed";
} {
  switch (state) {
    case "confirmed":
      return { badgeTone: "active", key: "confirmed", tone: "confirmed" };
    case "processing":
      return { badgeTone: "info", key: "processing", tone: "processing" };
    case "needs_review":
      return { badgeTone: "warning", key: "needsReview", tone: "needs-review" };
    case "manual_fallback_available":
      return { badgeTone: "warning", key: "manualFallback", tone: "fallback" };
    case "ready_to_confirm":
      return { badgeTone: "info", key: "ready", tone: "ready" };
  }
}
