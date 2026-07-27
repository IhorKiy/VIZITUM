"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  FieldReportExtractedData,
  NoOrderReason,
  Product,
} from "../lib/api-client";
import {
  confirmFieldReportAction,
  registerFieldReportAudioAction,
  registerProblemPhotoAction,
  transcribeFieldReportAction,
} from "../lib/field-report-actions";
import { INPUT_LIMITS } from "../lib/input-limits";
import {
  deriveVisitOutcome,
  isNoOrderReason,
  NO_ORDER_REASONS,
} from "../lib/visit-result";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HelpCircleIcon,
  LoaderIcon,
  MessageSquareIcon,
  MicIcon,
  PackageIcon,
  SaveIcon,
  SearchIcon,
  StopIcon,
} from "./icons";

type ProblemType = "return" | "damaged" | "expired" | "conflict";

// How many matrix chips a collapsed shelf panel shows. The rest are one tap
// away rather than dropped: confirming the check speaks for all of them.
const SHELF_CHIP_PREVIEW = 12;

// The chips and the catalog search both feed the same shelf list, and only
// ever need enough of a product to label and match it.
type ShelfProduct = {
  id: string;
  name: string;
  sku: string | null;
  category?: string | null;
};

type FieldVisitReportFormProps = {
  tenantSlug: string;
  visitId: string;
  products: Product[];
  // The outlet's whole matrix (assortment rows flagged `shouldBeListed`),
  // shown as one-tap chips — the full list, since confirming the check marks
  // every unmarked one present. Empty when the outlet has no assortment set
  // up — the catalog search inside the panel still covers that case.
  shelfProducts: ShelfProduct[];
  voiceHint: string | null;
};

function todayIsoDate(): string {
  // Local date, not UTC: new Date().toISOString() would prefill yesterday
  // between 00:00 and ~03:00 Kyiv time (UTC+2/+3).
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

function normalizeLookup(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isIsoDate(value?: string | null): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

// Fuzzy-matches spoken product names/codes against the products on screen,
// so a voice note naming an absent SKU lights up its chip.
function matchProductIds(
  products: ShelfProduct[],
  names: string[],
): Set<string> {
  if (!products.length || !names.length) return new Set();

  const spokenNames = names.map(normalizeLookup).filter(Boolean);

  return new Set(
    products
      .filter((product) => {
        const productName = normalizeLookup(product.name);
        const productCode = normalizeLookup(product.sku);
        return spokenNames.some(
          (name) =>
            productName === name ||
            productName.includes(name) ||
            name.includes(productName) ||
            Boolean(productCode && productCode === name),
        );
      })
      .map((product) => product.id),
  );
}

function formatProductDisplayName(product: ShelfProduct): string {
  return [product.sku, product.name].filter(Boolean).join(" · ");
}

function buildRecordingFileName(mimeType: string): string {
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";

  return `voice-note.${extension}`;
}

// Auto-stops a recording rather than letting it grow indefinitely — an
// unbounded recording (and its later transcript) has no fixed cap on the
// server side, so this is the one thing standing between an inattentive tap
// and an opaque transport failure much later.
const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000;

function resolveMediaRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
    return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return undefined;
}

const PROBLEM_TYPES: ProblemType[] = [
  "return",
  "damaged",
  "expired",
  "conflict",
];

export function FieldVisitReportForm({
  tenantSlug,
  visitId,
  products,
  shelfProducts,
  voiceHint,
}: FieldVisitReportFormProps) {
  const t = useTranslations("field.visit");
  const router = useRouter();

  // Two screens: "capture" is just the mic plus the tenant's speaking
  // checklist; "form" is the manual top-up. Voice lands on "form" after
  // transcription (success OR failure — the form is the fallback path).
  const [step, setStep] = useState<"capture" | "form">("capture");
  const [voiceHintOpen, setVoiceHintOpen] = useState(false);
  const [visitDate, setVisitDate] = useState(todayIsoDate);
  const [dateEditing, setDateEditing] = useState(false);
  // Null until the rep taps one: the result is the only required field on the
  // form, and a preselected value would report itself unread on every rushed
  // visit — exactly the noise this screen exists to avoid.
  const [orderPlaced, setOrderPlaced] = useState<boolean | null>(null);
  const [noOrderReason, setNoOrderReason] = useState<NoOrderReason | null>(
    null,
  );
  // Products the rep tapped as absent from the shelf, in tap order. This is
  // the whole of the shelf check: no per-SKU statuses, quantities or
  // comments, because a full audit is what turns this screen into "all ok".
  const [missingProductIds, setMissingProductIds] = useState<string[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfExpanded, setShelfExpanded] = useState(false);
  // Whether the rep actually looked. This is what licenses the report to mark
  // every unmarked required product as present, so it is never inferred from
  // an empty tap list — "nothing was missing" and "nobody checked" would
  // otherwise be the same report, and guessing wrong invents coverage.
  const [shelfChecked, setShelfChecked] = useState(false);
  // Once the rep answers the checkbox directly, chip taps stop overriding it.
  const [shelfCheckedTouched, setShelfCheckedTouched] = useState(false);
  // Problem is recorded by exception: no problem, no fields and no record.
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState<ProblemType | null>(null);
  const [problemNote, setProblemNote] = useState("");
  const [problemPhoto, setProblemPhoto] = useState<{
    objectId: string;
    fileName: string;
    contentType: string;
  } | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  // The one-sentence commitment for the next visit. It is the record the rep
  // reads at the door next time, so it sits second on the form and doubles as
  // the follow-up task — there is no separate task section to fill in.
  const [nextAction, setNextAction] = useState("");
  const [nextActionDueDate, setNextActionDueDate] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionMessage, setTranscriptionMessage] = useState<
    string | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const [recordingCapNotice, setRecordingCapNotice] = useState<string | null>(
    null,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target as Node)
      ) {
        setProductDropdownOpen(false);
        setProductSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const noOrderReasonLabels = useMemo<Record<NoOrderReason, string>>(
    () => ({
      closed: t("noOrderReasonClosed"),
      no_decision_maker: t("noOrderReasonNoDecisionMaker"),
      has_stock: t("noOrderReasonHasStock"),
      no_money: t("noOrderReasonNoMoney"),
      refused: t("noOrderReasonRefused"),
      other: t("noOrderReasonOther"),
    }),
    [t],
  );
  const problemTypeLabels = useMemo<Record<ProblemType, string>>(
    () => ({
      return: t("problemTypeReturn"),
      damaged: t("problemTypeDamaged"),
      expired: t("problemTypeExpired"),
      conflict: t("problemTypeConflict"),
    }),
    [t],
  );

  function pickResult(placed: boolean) {
    setOrderPlaced(placed);
    if (placed) setNoOrderReason(null);
  }

  // Register the object, then PUT the image straight to storage from the
  // browser, same as the voice note: a Server Action would cap the body at
  // ~1 MB, which a phone photo clears on its own.
  async function handlePhotoSelected(file: File) {
    setIsUploadingPhoto(true);
    setError(null);

    try {
      const registerResult = await registerProblemPhotoAction(visitId, {
        fileName: file.name || "problem-photo.jpg",
        contentType: file.type || "image/jpeg",
        sizeBytes: file.size,
      });

      if (!registerResult.ok) {
        setError(registerResult.message);
        return;
      }

      const uploadUrl = registerResult.data.uploadUrl;

      if (!uploadUrl) {
        setError(t("problemPhotoErrorNotice"));
        return;
      }

      const uploadResponse = await fetch(uploadUrl.url, {
        method: uploadUrl.method,
        headers: uploadUrl.headers,
        body: file,
      });

      if (!uploadResponse.ok) {
        setError(t("problemPhotoErrorNotice"));
        return;
      }

      setProblemPhoto({
        objectId: registerResult.data.storageObject.id,
        fileName: file.name || "problem-photo.jpg",
        // The backend accepts HEIC (what an iPhone shoots by default), which
        // only Safari can render — the summary needs the type to decide
        // between an <img> and a plain link.
        contentType: registerResult.data.storageObject.contentType,
      });
    } catch {
      setError(t("problemPhotoErrorNotice"));
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  // Collapsing the problem row discards it: the whole point of the exception
  // is that a visit without a problem carries no problem record.
  function closeProblem() {
    setProblemOpen(false);
    setProblemType(null);
    setProblemNote("");
    setProblemPhoto(null);
  }

  function toggleMissingProduct(productId: string) {
    const next = missingProductIds.includes(productId)
      ? missingProductIds.filter((id) => id !== productId)
      : [...missingProductIds, productId];

    setMissingProductIds(next);

    // Marking a gap is itself proof the rep looked at the shelf, so the
    // confirmation follows the taps instead of asking for it twice — and
    // undoing the last mark takes that proof back with it, so a mis-tap the
    // rep immediately corrects cannot leave "I checked the shelf" standing
    // and mark the whole matrix in stock. Once the rep works the checkbox
    // themselves the answer is theirs and taps stop moving it.
    if (!shelfCheckedTouched) {
      setShelfChecked(next.length > 0);
    }
  }

  function applyExtractedVisitData(data: FieldReportExtractedData): string[] {
    const filledSections: string[] = [];

    if (data.visitDate && isIsoDate(data.visitDate)) {
      setVisitDate(data.visitDate);
      if (data.visitDate !== todayIsoDate())
        filledSections.push(t("sectionDate"));
    }
    if (data.orderPlaced !== null) {
      setOrderPlaced(data.orderPlaced);
      setNoOrderReason(
        !data.orderPlaced && isNoOrderReason(data.noOrderReason)
          ? data.noOrderReason
          : null,
      );
      filledSections.push(t("sectionResult"));
    }

    const matchedMissingIds = matchProductIds(
      [...shelfProducts, ...products],
      data.missingProducts,
    );

    if (matchedMissingIds.size > 0) {
      setMissingProductIds((current) => [
        ...current,
        ...[...matchedMissingIds].filter((id) => !current.includes(id)),
      ]);
      // Deliberately does not confirm the check the way a tap does: naming a
      // gap out loud is evidence about that SKU, not about every other one in
      // the matrix. The panel opens so the rep confirms it themselves.
      setShelfOpen(true);
      filledSections.push(t("sectionShelf"));
    }

    if (data.notes) {
      setNotes(data.notes);
      // Otherwise transcribed notes would sit inside a collapsed row where the
      // rep can't see what the AI wrote before saving.
      setNotesOpen(true);
      filledSections.push(t("sectionNotes"));
    }

    if (data.problemType || data.problemNote) {
      setProblemType(data.problemType);
      setProblemNote(data.problemNote ?? "");
      setProblemOpen(true);
      filledSections.push(t("sectionProblem"));
    }

    if (data.nextAction) setNextAction(data.nextAction);
    if (data.nextActionDueDate && isIsoDate(data.nextActionDueDate))
      setNextActionDueDate(data.nextActionDueDate);
    if (data.nextAction) filledSections.push(t("sectionNextAction"));

    return filledSections;
  }

  async function handleTranscription(blob: Blob, mimeType: string) {
    setIsTranscribing(true);
    setError(null);
    setTranscriptionMessage(null);

    try {
      // Register the object, then PUT the recording straight from the
      // browser to storage using the presigned URL that comes back — the
      // bytes never pass through a Next.js Server Action, which caps request
      // bodies at ~1 MB by default regardless of encoding. Only the small
      // JSON register/transcribe calls go through field-report-actions.ts.
      const registerResult = await registerFieldReportAudioAction(visitId, {
        fileName: buildRecordingFileName(mimeType),
        contentType: mimeType,
        sizeBytes: blob.size,
      });

      if (!registerResult.ok) {
        setError(registerResult.message);
        return;
      }

      const uploadUrl = registerResult.data.uploadUrl;

      if (!uploadUrl) {
        setError(t("voiceErrorNotice"));
        return;
      }

      const uploadResponse = await fetch(uploadUrl.url, {
        method: uploadUrl.method,
        headers: uploadUrl.headers,
        body: blob,
      });

      if (!uploadResponse.ok) {
        setError(t("voiceErrorNotice"));
        return;
      }

      const result = await transcribeFieldReportAction(visitId, {
        audioObjectId: registerResult.data.storageObject.id,
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          category: product.category,
        })),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const filledSections = applyExtractedVisitData(result.data.extractedData);

      if (filledSections.length > 0) {
        setTranscriptionMessage(
          t("voiceAppliedSummary", { sections: filledSections.join(", ") }),
        );
      } else if (result.data.transcript) {
        setTranscriptionMessage(t("voiceEmptyNotice"));
      }
    } catch {
      setError(t("voiceErrorNotice"));
    } finally {
      setIsTranscribing(false);
      // Whatever happened to the audio, the rep lands on the manual form:
      // on success to review what was extracted, on failure as the always-
      // available fallback path.
      setStep("form");
    }
  }

  async function startRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(t("voiceUnsupported"));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = resolveMediaRecorderMimeType();
      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = mediaRecorder;
      streamRef.current = stream;
      chunksRef.current = [];

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      mediaRecorder.addEventListener("stop", () => {
        const recordedMimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, {
          type: recordedMimeType,
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        void handleTranscription(audioBlob, recordedMimeType);
      });

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
      setTranscriptionMessage(null);
      setRecordingCapNotice(null);
      recordingTimeoutRef.current = setTimeout(() => {
        setRecordingCapNotice(t("voiceMaxDurationNotice"));
        stopRecording();
      }, MAX_RECORDING_DURATION_MS);
    } catch {
      setError(t("voiceUnsupported"));
    }
  }

  function stopRecording() {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Confirming a report locks the visit as completed for good, so the form
    // still refuses to submit nothing — but the bar is now the visit result
    // itself rather than any-field-touched: it is the one thing every visit
    // has, and demanding it costs a single tap.
    if (orderPlaced === null) {
      setError(t("resultRequiredError"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Every tapped chip means one thing — this SKU was not on the shelf — so
    // the report's product updates are all `out_of_stock` with no quantities
    // to reconcile.
    const missingProducts = missingProductIds
      .map((productId) => productById.get(productId))
      .filter((product): product is ShelfProduct => Boolean(product));

    const productUpdates = missingProducts.map((product) => ({
      productId: product.id,
      productName: product.name,
      productCode: product.sku,
      status: "out_of_stock" as const,
      stock: null,
      order: null,
      sale: null,
      comment: "",
    }));

    const mentionedProducts = missingProducts.map((product) => ({
      name: product.name,
      status: "issue",
      evidence: "",
    }));

    const trimmedNotes = notes.trim();
    const trimmedNextAction = nextAction.trim();
    const trimmedProblemNote = problemNote.trim();

    // By exception: a problem exists only if the rep said something about it.
    // An opened-then-emptied panel leaves no trace in the report.
    const problem =
      problemType || trimmedProblemNote || problemPhoto
        ? {
            type: problemType,
            note: trimmedProblemNote,
            photoObjectId: problemPhoto?.objectId ?? null,
            photoContentType: problemPhoto?.contentType ?? null,
          }
        : null;

    // The due-date input hides itself when the agreement is cleared, but the
    // state behind it would otherwise still be written to the report.
    const nextActionDueDateForReport = trimmedNextAction
      ? nextActionDueDate || null
      : null;

    // The agreement is the follow-up task: one line the rep already wrote,
    // turned into the row they'll see on the next visit, instead of a second
    // pass over four task-type boxes that said the same thing.
    const tasksToCreate = trimmedNextAction
      ? [
          {
            title: trimmedNextAction,
            description: "",
            dueDate: nextActionDueDateForReport,
            assignee: "representative",
          },
        ]
      : [];

    // Manager report views and every already-confirmed report read the
    // positive/neutral/negative `outcome`, so it stays in the payload —
    // derived from what the rep actually reported rather than asked for.
    const outcome = deriveVisitOutcome(orderPlaced, noOrderReason);

    const confirmedData = {
      summary: trimmedNotes || trimmedNextAction,
      resultStatus: outcome,
      agreements: [],
      objections: [],
      mentionedProducts,
      nextActions: trimmedNextAction ? [trimmedNextAction] : [],
      tasksToCreate,
      locationUpdates: [],
      confidence: 1,
      requiresUserConfirmation: false,
      fieldReport: {
        visitDate,
        outcome,
        orderPlaced,
        noOrderReason,
        // Derived, not asked: an untouched shelf check says nothing about the
        // shelf, so it stays null instead of claiming everything is in stock.
        stockStatus: missingProducts.length > 0 ? "out_of_stock" : null,
        // What licenses the backend to write this location's assortment rows:
        // the unmarked required products are confirmed present, the marked
        // ones absent. Without it the report is stored and coverage is left
        // alone.
        shelfChecked,
        notes: trimmedNotes,
        nextAction: trimmedNextAction,
        nextActionDueDate: nextActionDueDateForReport,
        productUpdates,
        problem,
      },
    };

    const result = await confirmFieldReportAction(visitId, confirmedData);

    if (!result.ok) {
      setError(result.message || t("saveFailedError"));
      setIsSubmitting(false);
      return;
    }

    // Deliberately today's route, not the screen the report was opened from.
    // Confirming ends the visit, so the next thing the rep needs is the next
    // stop — that's a workflow step forward, not the back control's job of
    // undoing a drill-down (the BackLink above still returns to the opener).
    // `/field` is also the only screen that renders the "report confirmed"
    // notice this redirect carries; routing to the opener instead would mean
    // teaching the history and location screens to show it too.
    router.push(`/${tenantSlug}/field?report=confirmed`);
  }

  const filteredProducts = products.filter((product) =>
    [product.name, product.sku, product.category].some((value) =>
      (value ?? "").toLowerCase().includes(productSearch.toLowerCase()),
    ),
  );
  const productById = new Map<string, ShelfProduct>(
    [...shelfProducts, ...products].map((product) => [product.id, product]),
  );
  const missingProductIdSet = new Set(missingProductIds);
  // The outlet's whole matrix, plus anything picked out of the full catalog —
  // a product tapped through the search has to stay visible as a chip too.
  const shelfChips = [
    ...shelfProducts,
    ...missingProductIds
      .filter((id) => !shelfProducts.some((product) => product.id === id))
      .map((id) => productById.get(id))
      .filter((product): product is ShelfProduct => Boolean(product)),
  ];
  // A long matrix is collapsed rather than truncated: confirming the check
  // speaks for every required product, so all of them stay one tap away.
  // Anything already marked missing is kept visible regardless of position.
  const shelfChipsCollapsed =
    !shelfExpanded && shelfChips.length > SHELF_CHIP_PREVIEW;
  const visibleShelfChips = shelfChipsCollapsed
    ? shelfChips.filter(
        (product, index) =>
          index < SHELF_CHIP_PREVIEW || missingProductIdSet.has(product.id),
      )
    : shelfChips;
  const showDateInput = dateEditing || visitDate !== todayIsoDate();

  return (
    <article
      className={
        step === "capture" ? "visit-card visit-card--bare" : "visit-card"
      }
    >
      {error ? (
        <section
          className="notice-panel danger"
          aria-label={t("reportErrorAria")}
        >
          <p>{error}</p>
        </section>
      ) : null}
      {transcriptionMessage ? (
        <p className="notice-inline success" role="status">
          {transcriptionMessage}
        </p>
      ) : null}

      {step === "capture" ? (
        <div className="visit-form">
          {voiceHint ? (
            <div className="voice-hint-toggle-row">
              <button
                aria-expanded={voiceHintOpen}
                aria-label={t("voiceChecklistTitle")}
                className="voice-hint-toggle"
                onClick={() => setVoiceHintOpen((open) => !open)}
                type="button"
              >
                <HelpCircleIcon size={22} />
              </button>
            </div>
          ) : null}

          <div className="voice-capture">
            {isRecording ? (
              <p className="voice-capture-hint">{t("voiceHintRecording")}</p>
            ) : null}
            <button
              aria-label={
                isRecording ? t("voiceStopAria") : t("voiceRecordAria")
              }
              className={`voice-capture-button${isRecording ? " recording" : ""}`}
              disabled={isTranscribing}
              onClick={
                isRecording ? stopRecording : () => void startRecording()
              }
              type="button"
            >
              {isRecording ? <StopIcon size={36} /> : <MicIcon size={48} />}
            </button>
            {voiceHint && (voiceHintOpen || isRecording) ? (
              <div className="voice-hint-card">{voiceHint}</div>
            ) : null}
            {isTranscribing ? (
              <div className="voice-capture-status">
                <LoaderIcon />
                {t("voiceProcessing")}
              </div>
            ) : null}
            {recordingCapNotice ? (
              <p className="form-hint">{recordingCapNotice}</p>
            ) : null}
          </div>

          <div className="capture-manual-bar">
            <button
              className="secondary-button"
              disabled={isRecording || isTranscribing}
              onClick={() => setStep("form")}
              type="button"
            >
              {t("fillManually")}
            </button>
          </div>
        </div>
      ) : (
        <form className="visit-form" onSubmit={handleSubmit}>
          <button
            className="inline-toggle"
            disabled={isSubmitting}
            onClick={() => setStep("capture")}
            type="button"
          >
            {t("backToVoice")}
          </button>

          <div>
            <span className="form-field-title">
              {t("outcomeLabel")}
              <span className="form-field-required">{t("resultRequired")}</span>
            </span>
            <div
              className="visit-result-tabs"
              role="group"
              aria-label={t("outcomeLabel")}
            >
              <button
                aria-pressed={orderPlaced === true}
                className={`visit-result-tab${orderPlaced === true ? " order" : ""}`}
                onClick={() => pickResult(true)}
                type="button"
              >
                {t("resultOrderPlaced")}
              </button>
              <button
                aria-pressed={orderPlaced === false}
                className={`visit-result-tab${orderPlaced === false ? " no-order" : ""}`}
                onClick={() => pickResult(false)}
                type="button"
              >
                {t("resultNoOrder")}
              </button>
            </div>

            {orderPlaced === false ? (
              <div
                className="chip-list visit-result-reasons"
                role="group"
                aria-label={t("noOrderReasonLabel")}
              >
                {NO_ORDER_REASONS.map((reason) => (
                  <button
                    aria-pressed={noOrderReason === reason}
                    className={`status-chip danger${noOrderReason === reason ? " active" : ""}`}
                    key={reason}
                    onClick={() =>
                      setNoOrderReason((current) =>
                        current === reason ? null : reason,
                      )
                    }
                    type="button"
                  >
                    {noOrderReasonLabels[reason]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="visit-agreement">
            <label>
              <span>{t("nextActionLabel")}</span>
              <textarea
                maxLength={INPUT_LIMITS.title}
                onChange={(event) => setNextAction(event.target.value)}
                placeholder={t("nextActionPlaceholder")}
                rows={2}
                value={nextAction}
              />
            </label>
            <p className="form-hint">{t("nextActionHint")}</p>

            {nextAction.trim() ? (
              <label>
                <span>{t("nextActionDueDateLabel")}</span>
                <input
                  onChange={(event) => setNextActionDueDate(event.target.value)}
                  type="date"
                  value={nextActionDueDate}
                />
              </label>
            ) : null}
          </div>

          {shelfOpen ? (
            <div className="shelf-panel" id="shelf-panel">
              <div className="panel-head">
                <p>{t("shelfTitle")}</p>
                <button
                  aria-label={t("shelfCollapseAria")}
                  onClick={() => setShelfOpen(false)}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
              <p className="form-hint">
                {shelfChips.length > 0 ? t("shelfHint") : t("shelfEmptyHint")}
              </p>

              {shelfChips.length > 0 ? (
                <div
                  className="chip-list"
                  role="group"
                  aria-label={t("shelfTitle")}
                >
                  {visibleShelfChips.map((product) => {
                    const missing = missingProductIdSet.has(product.id);
                    return (
                      <button
                        aria-pressed={missing}
                        className={`status-chip danger${missing ? " active" : ""}`}
                        key={product.id}
                        onClick={() => toggleMissingProduct(product.id)}
                        type="button"
                      >
                        {formatProductDisplayName(product)}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {shelfChipsCollapsed ? (
                <button
                  className="link-button"
                  onClick={() => setShelfExpanded(true)}
                  type="button"
                >
                  {t("shelfShowAll", { count: shelfChips.length })}
                </button>
              ) : null}

              {shelfChips.length > 0 ? (
                <label className="checkbox-label shelf-checked">
                  <input
                    checked={shelfChecked}
                    onChange={(event) => {
                      setShelfChecked(event.target.checked);
                      setShelfCheckedTouched(true);
                    }}
                    type="checkbox"
                  />
                  <span>
                    {t("shelfCheckedLabel")}
                    <span className="form-hint">{t("shelfCheckedHint")}</span>
                  </span>
                </label>
              ) : null}

              <div className="combo-field" ref={productDropdownRef}>
                <button
                  aria-expanded={productDropdownOpen}
                  className="combo-trigger"
                  onClick={() => setProductDropdownOpen((open) => !open)}
                  type="button"
                >
                  <span>{t("shelfOtherProduct")}</span>
                  <ChevronDownIcon />
                </button>

                {productDropdownOpen ? (
                  <div className="combo-panel">
                    <div className="combo-search">
                      <SearchIcon />
                      <input
                        autoFocus
                        maxLength={INPUT_LIMITS.search}
                        onChange={(event) =>
                          setProductSearch(event.target.value)
                        }
                        placeholder={t("productSearchPlaceholder")}
                        value={productSearch}
                      />
                      {productSearch ? (
                        <button
                          onClick={() => setProductSearch("")}
                          type="button"
                        >
                          <CloseIcon />
                        </button>
                      ) : null}
                    </div>
                    <div className="combo-list">
                      {!products.length ? (
                        <p className="combo-empty">{t("productsEmpty")}</p>
                      ) : filteredProducts.length === 0 ? (
                        <p className="combo-empty">{t("productsNoMatch")}</p>
                      ) : (
                        filteredProducts.map((product) => {
                          const selected = missingProductIdSet.has(product.id);
                          return (
                            <button
                              className={`combo-option${selected ? " selected" : ""}`}
                              key={product.id}
                              onClick={() => toggleMissingProduct(product.id)}
                              type="button"
                            >
                              <span className="combo-option-check">
                                {selected ? <CheckIcon /> : null}
                              </span>
                              <span className="combo-option-name">
                                {product.name}
                              </span>
                              {product.sku || product.category ? (
                                <span className="combo-option-meta">
                                  {[product.sku, product.category]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              aria-controls="shelf-panel"
              aria-expanded={false}
              className={`exception-row${shelfChecked ? " filled" : ""}`}
              onClick={() => setShelfOpen(true)}
              type="button"
            >
              <span aria-hidden="true" className="row-icon">
                <PackageIcon />
              </span>
              <span className="label">{t("shelfTitle")}</span>
              <span className="opt">
                {missingProductIds.length > 0
                  ? t("shelfMissingCount", { count: missingProductIds.length })
                  : shelfChecked
                    ? t("shelfAllPresent")
                    : t("shelfOptional")}
              </span>
              <span aria-hidden="true" className="caret">
                <ChevronDownIcon />
              </span>
            </button>
          )}

          {problemOpen ? (
            <div className="problem-panel">
              <div className="panel-head danger">
                <p>{t("problemTitle")}</p>
                <button
                  aria-label={t("problemDiscardAria")}
                  onClick={closeProblem}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>

              <div
                className="chip-list"
                role="group"
                aria-label={t("problemTypeLabel")}
              >
                {PROBLEM_TYPES.map((type) => (
                  <button
                    aria-pressed={problemType === type}
                    className={`status-chip danger${problemType === type ? " active" : ""}`}
                    key={type}
                    onClick={() =>
                      setProblemType((current) =>
                        current === type ? null : type,
                      )
                    }
                    type="button"
                  >
                    {problemTypeLabels[type]}
                  </button>
                ))}
              </div>

              <label className="problem-photo-button">
                <CameraIcon />
                <span>
                  {isUploadingPhoto
                    ? t("problemPhotoUploading")
                    : problemPhoto
                      ? problemPhoto.fileName
                      : t("problemPhotoAdd")}
                </span>
                <input
                  accept="image/*"
                  capture="environment"
                  disabled={isUploadingPhoto}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handlePhotoSelected(file);
                  }}
                  type="file"
                />
              </label>

              {problemPhoto ? (
                <button
                  className="inline-toggle"
                  onClick={() => setProblemPhoto(null)}
                  type="button"
                >
                  {t("problemPhotoRemove")}
                </button>
              ) : null}

              <input
                maxLength={INPUT_LIMITS.title}
                onChange={(event) => setProblemNote(event.target.value)}
                placeholder={t("problemNotePlaceholder")}
                value={problemNote}
              />
            </div>
          ) : (
            <button
              aria-expanded={false}
              className="exception-row"
              onClick={() => setProblemOpen(true)}
              type="button"
            >
              <span aria-hidden="true" className="row-icon danger">
                <AlertTriangleIcon />
              </span>
              <span className="label">{t("problemTitle")}</span>
              <span className="opt">{t("problemOptional")}</span>
              <span aria-hidden="true" className="caret">
                <ChevronDownIcon />
              </span>
            </button>
          )}

          {notesOpen ? (
            <div className="notes-panel">
              <div className="panel-head">
                <p>{t("notesLabel")}</p>
                <button
                  aria-label={t("notesCollapseAria")}
                  onClick={() => setNotesOpen(false)}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
              <textarea
                autoFocus
                maxLength={INPUT_LIMITS.notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("notesPlaceholder")}
                value={notes}
              />
            </div>
          ) : (
            <button
              aria-expanded={false}
              className={`exception-row${notes.trim() ? " filled" : ""}`}
              onClick={() => setNotesOpen(true)}
              type="button"
            >
              <span aria-hidden="true" className="row-icon quiet">
                <MessageSquareIcon />
              </span>
              <span className="label">{t("notesLabel")}</span>
              <span className="opt">
                {notes.trim() ? t("notesFilled") : t("notesOptional")}
              </span>
              <span aria-hidden="true" className="caret">
                <ChevronDownIcon />
              </span>
            </button>
          )}

          {showDateInput ? (
            <label>
              <span>{t("visitDateLabel")}</span>
              <input
                onChange={(event) => setVisitDate(event.target.value)}
                type="date"
                value={visitDate}
              />
            </label>
          ) : (
            <div className="visit-date-row">
              <span>
                {t("visitDateLabel")}: {t("dateToday")}
              </span>
              <button
                className="inline-toggle"
                onClick={() => setDateEditing(true)}
                type="button"
              >
                {t("dateChange")}
              </button>
            </div>
          )}

          <div className="field-report-submit-bar">
            <button
              className="primary-button field-report-submit"
              disabled={isSubmitting || isRecording || isTranscribing}
              type="submit"
            >
              {isSubmitting ? <LoaderIcon /> : <SaveIcon />}
              {isSubmitting ? t("saving") : t("saveReport")}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
