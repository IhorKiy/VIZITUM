"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { FieldReportExtractedData, Product } from "../lib/api-client";
import {
  confirmFieldReportAction,
  registerFieldReportAudioAction,
  transcribeFieldReportAction,
} from "../lib/field-report-actions";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HelpCircleIcon,
  ListTodoIcon,
  LoaderIcon,
  MicIcon,
  PackageIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  StopIcon,
} from "./icons";

type Outcome = "positive" | "neutral" | "negative";
type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
type ProductUpdateStatus =
  "in_stock" | "out_of_stock" | "to_order" | "not_relevant";
type TaskType =
  "assortment" | "merchandising" | "recommendation" | "special" | "note";

// One row per product touched during the visit. `presented` feeds the
// report's presented-products list; a non-null `status` (or any quantity /
// comment) additionally emits a product update — the same two collections
// the old two-section UI produced, so confirmedData keeps its shape.
type ProductRow = {
  productId: string;
  presented: boolean;
  status: ProductUpdateStatus | null;
  stock: string;
  order: string;
  sale: string;
  comment: string;
  detailsOpen: boolean;
};

type TaskEntry = {
  type: TaskType;
  description: string;
};

type FieldVisitReportFormProps = {
  tenantSlug: string;
  visitId: string;
  products: Product[];
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

function createProductRow(productId: string): ProductRow {
  return {
    productId,
    presented: true,
    status: null,
    stock: "",
    order: "",
    sale: "",
    comment: "",
    detailsOpen: false,
  };
}

function rowHasUpdateData(row: ProductRow): boolean {
  return (
    row.status !== null ||
    Boolean(row.stock.trim()) ||
    Boolean(row.order.trim()) ||
    Boolean(row.sale.trim()) ||
    Boolean(row.comment.trim())
  );
}

function parseOptionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function hasInvalidNumber(...values: string[]): boolean {
  return values.some((value) => value.trim() && !/^\d+$/.test(value.trim()));
}

function normalizeLookup(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isIsoDate(value?: string | null): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function toDraftNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function findCatalogProduct(
  products: Product[],
  productName?: string | null,
  productCode?: string | null,
): Product | undefined {
  const code = normalizeLookup(productCode);

  if (code) {
    const exactCodeMatch = products.find(
      (product) => normalizeLookup(product.sku) === code,
    );
    if (exactCodeMatch) return exactCodeMatch;
  }

  const name = normalizeLookup(productName);
  if (!name) return undefined;

  return products.find((product) => {
    const catalogName = normalizeLookup(product.name);
    return (
      catalogName === name ||
      catalogName.includes(name) ||
      name.includes(catalogName)
    );
  });
}

function matchPresentedProductIds(
  products: Product[],
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

function formatProductDisplayName(product: Product): string {
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

const TASK_TYPES: TaskType[] = [
  "assortment",
  "merchandising",
  "recommendation",
  "special",
  "note",
];

const PRODUCT_STATUS_OPTIONS: ProductUpdateStatus[] = [
  "in_stock",
  "out_of_stock",
  "to_order",
  "not_relevant",
];

export function FieldVisitReportForm({
  tenantSlug,
  visitId,
  products,
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
  const [outcome, setOutcome] = useState<Outcome>("neutral");
  const [stockStatus, setStockStatus] = useState<StockStatus>("in_stock");
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskEntries, setTaskEntries] = useState<TaskEntry[]>([]);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
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
  const taskPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target as Node)
      ) {
        setProductDropdownOpen(false);
        setProductSearch("");
      }
      if (
        taskPickerRef.current &&
        !taskPickerRef.current.contains(event.target as Node)
      ) {
        setTaskPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const taskTypeLabels = useMemo<Record<TaskType, string>>(
    () => ({
      assortment: t("taskAssortmentLabel"),
      merchandising: t("taskMerchandisingLabel"),
      recommendation: t("taskRecommendationLabel"),
      special: t("taskSpecialLabel"),
      note: t("taskNoteLabel"),
    }),
    [t],
  );
  const taskTypePlaceholders = useMemo<Record<TaskType, string>>(
    () => ({
      assortment: t("taskAssortmentPlaceholder"),
      merchandising: t("taskMerchandisingPlaceholder"),
      recommendation: t("taskRecommendationPlaceholder"),
      special: t("taskSpecialPlaceholder"),
      note: t("taskNotePlaceholder"),
    }),
    [t],
  );

  const outcomeOptions = useMemo(
    () => [
      { value: "positive" as const, label: t("outcomePositive") },
      { value: "neutral" as const, label: t("outcomeNeutral") },
      { value: "negative" as const, label: t("outcomeNegative") },
    ],
    [t],
  );
  const stockOptions = useMemo(
    () => [
      { value: "in_stock" as const, label: t("stockInStock") },
      { value: "low_stock" as const, label: t("stockLowStock") },
      { value: "out_of_stock" as const, label: t("stockOutOfStock") },
    ],
    [t],
  );
  const productStatusLabels = useMemo<Record<ProductUpdateStatus, string>>(
    () => ({
      in_stock: t("skuStatusInStock"),
      out_of_stock: t("skuStatusOutOfStock"),
      to_order: t("skuStatusToOrder"),
      not_relevant: t("skuStatusNotRelevant"),
    }),
    [t],
  );

  function toggleProductRow(productId: string) {
    setProductRows((current) => {
      const existing = current.find((row) => row.productId === productId);
      if (!existing) return [...current, createProductRow(productId)];
      return current.filter((row) => row.productId !== productId);
    });
  }

  function updateRow(productId: string, patch: Partial<ProductRow>) {
    setProductRows((current) =>
      current.map((row) =>
        row.productId === productId ? { ...row, ...patch } : row,
      ),
    );
  }

  function addTaskEntry(type: TaskType) {
    setTaskEntries((current) =>
      current.some((entry) => entry.type === type)
        ? current
        : [...current, { type, description: "" }],
    );
    setTaskPickerOpen(false);
  }

  function applyExtractedVisitData(data: FieldReportExtractedData): string[] {
    const filledSections: string[] = [];

    if (data.visitDate && isIsoDate(data.visitDate)) {
      setVisitDate(data.visitDate);
      if (data.visitDate !== todayIsoDate())
        filledSections.push(t("sectionDate"));
    }
    if (data.outcome) setOutcome(data.outcome);
    if (data.stockStatus) setStockStatus(data.stockStatus);
    if (data.outcome || data.stockStatus)
      filledSections.push(t("sectionResult"));

    const matchedPresentedIds = matchPresentedProductIds(
      products,
      data.productsPresented,
    );

    const matchedUpdates = products.length
      ? data.productUpdates
          .map((update) => {
            const product = findCatalogProduct(
              products,
              update.productName,
              update.productCode,
            );
            if (!product) return null;

            return {
              productId: product.id,
              status: update.status ?? null,
              stock: toDraftNumber(update.stock),
              order: toDraftNumber(update.order),
              sale: toDraftNumber(update.sale),
              comment: update.comment ?? "",
            };
          })
          .filter(
            (update): update is NonNullable<typeof update> => update !== null,
          )
      : [];

    if (matchedPresentedIds.size > 0 || matchedUpdates.length > 0) {
      setProductRows((current) => {
        const next = [...current];

        const ensureRow = (productId: string): number => {
          const index = next.findIndex((row) => row.productId === productId);
          if (index >= 0) return index;
          next.push({ ...createProductRow(productId), presented: false });
          return next.length - 1;
        };

        matchedPresentedIds.forEach((productId) => {
          const index = ensureRow(productId);
          next[index] = { ...next[index], presented: true };
        });

        matchedUpdates.forEach((update) => {
          const index = ensureRow(update.productId);
          const row = next[index];
          next[index] = {
            ...row,
            status: update.status ?? row.status,
            stock: update.stock || row.stock,
            order: update.order || row.order,
            sale: update.sale || row.sale,
            comment: update.comment || row.comment,
            detailsOpen:
              row.detailsOpen ||
              Boolean(
                update.stock || update.order || update.sale || update.comment,
              ),
          };
        });

        return next;
      });
      filledSections.push(t("sectionProducts"));
    }

    if (data.notes) setNotes(data.notes);
    if (data.nextAction) setNextAction(data.nextAction);
    if (data.notes || data.nextAction) filledSections.push(t("sectionNotes"));

    if (data.tasks.dueDate && isIsoDate(data.tasks.dueDate))
      setTaskDueDate(data.tasks.dueDate);
    const extractedTaskTypes = TASK_TYPES.filter((type) =>
      Boolean(data.tasks[type]),
    );
    if (extractedTaskTypes.length > 0) {
      setTaskEntries((current) => {
        const next = [...current];
        extractedTaskTypes.forEach((type) => {
          const description = data.tasks[type] ?? "";
          const index = next.findIndex((entry) => entry.type === type);
          if (index >= 0) next[index] = { ...next[index], description };
          else next.push({ type, description });
        });
        return next;
      });
      filledSections.push(t("sectionTasks"));
    }

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

    const invalidProductRow = productRows.some((row) =>
      hasInvalidNumber(row.stock, row.order, row.sale),
    );
    if (invalidProductRow) {
      setError(t("invalidSkuNumbersError"));
      return;
    }

    // One accidental tap on "Save report" would otherwise permanently lock
    // the visit as completed with a content-free report — require at least
    // one real piece of the report before letting it through.
    const hasReportContent =
      Boolean(notes.trim()) ||
      Boolean(nextAction.trim()) ||
      productRows.length > 0 ||
      taskEntries.some((entry) => entry.description.trim());

    if (!hasReportContent) {
      setError(t("emptyReportError"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const presentedProducts = productRows
      .filter((row) => row.presented)
      .map((row) => products.find((product) => product.id === row.productId))
      .filter((product): product is Product => Boolean(product));

    const productUpdates = productRows.filter(rowHasUpdateData).map((row) => {
      const product = products.find((item) => item.id === row.productId);

      return {
        productId: row.productId,
        productName: product?.name ?? "",
        productCode: product?.sku ?? null,
        status: row.status ?? "in_stock",
        stock: parseOptionalNumber(row.stock),
        order: parseOptionalNumber(row.order),
        sale: parseOptionalNumber(row.sale),
        comment: row.comment.trim(),
      };
    });

    const mentionedProducts = [
      ...presentedProducts.map((product) => ({
        name: product.name,
        status: "presented",
        evidence: "",
      })),
      ...productUpdates
        .filter((update) => update.productName)
        .map((update) => ({
          name: update.productName,
          status:
            update.status === "out_of_stock" || update.status === "to_order"
              ? "issue"
              : "presented",
          evidence:
            update.comment ||
            [
              update.stock !== null
                ? `${t("skuStockLabel")}: ${update.stock}`
                : null,
              update.order !== null
                ? `${t("skuOrderLabel")}: ${update.order}`
                : null,
              update.sale !== null
                ? `${t("skuSaleLabel")}: ${update.sale}`
                : null,
            ]
              .filter(Boolean)
              .join(", "),
        })),
    ];

    const trimmedNotes = notes.trim();
    const trimmedNextAction = nextAction.trim();

    const tasksToCreate = taskEntries
      .map((entry) => ({
        title: taskTypeLabels[entry.type],
        description: entry.description.trim(),
      }))
      .filter((task) => task.description)
      .map((task) => ({
        title: task.title,
        description: task.description,
        dueDate: taskDueDate || null,
        assignee: "representative",
      }));

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
        stockStatus,
        presentedProductIds: presentedProducts.map((product) => product.id),
        presentedProducts: presentedProducts.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
        })),
        notes: trimmedNotes,
        nextAction: trimmedNextAction,
        productUpdates,
      },
    };

    const result = await confirmFieldReportAction(visitId, confirmedData);

    if (!result.ok) {
      setError(result.message || t("saveFailedError"));
      setIsSubmitting(false);
      return;
    }

    router.push(`/${tenantSlug}/field?report=confirmed`);
  }

  const filteredProducts = products.filter((product) =>
    [product.name, product.sku, product.category].some((value) =>
      (value ?? "").toLowerCase().includes(productSearch.toLowerCase()),
    ),
  );
  const rowProductIds = new Set(productRows.map((row) => row.productId));
  const availableTaskTypes = TASK_TYPES.filter(
    (type) => !taskEntries.some((entry) => entry.type === type),
  );
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
        <section className="notice-panel success">
          <p>{transcriptionMessage}</p>
        </section>
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
            <span className="form-field-title">{t("outcomeLabel")}</span>
            <div
              className="segmented"
              role="group"
              aria-label={t("outcomeLabel")}
            >
              {outcomeOptions.map((option) => (
                <button
                  aria-pressed={outcome === option.value}
                  className={`segmented-option${outcome === option.value ? " active" : ""}`}
                  key={option.value}
                  onClick={() => setOutcome(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="form-field-title">{t("stockStatusLabel")}</span>
            <div
              className="segmented"
              role="group"
              aria-label={t("stockStatusLabel")}
            >
              {stockOptions.map((option) => (
                <button
                  aria-pressed={stockStatus === option.value}
                  className={`segmented-option${stockStatus === option.value ? " active" : ""}`}
                  key={option.value}
                  onClick={() => setStockStatus(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label>
            <span>{t("notesLabel")}</span>
            <textarea
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("notesPlaceholder")}
              value={notes}
            />
          </label>

          <div className="field-panel-card">
            <div className="field-panel-card-toggle">
              <PackageIcon />
              <span>{t("productsTitle")}</span>
              {productRows.length > 0 ? (
                <span className="eyebrow">
                  {t("productsCount", { count: productRows.length })}
                </span>
              ) : null}
            </div>

            <div className="combo-field" ref={productDropdownRef}>
              <button
                aria-expanded={productDropdownOpen}
                className="combo-trigger"
                onClick={() => setProductDropdownOpen((open) => !open)}
                type="button"
              >
                <span>{t("productsAddPlaceholder")}</span>
                <ChevronDownIcon />
              </button>

              {productDropdownOpen ? (
                <div className="combo-panel">
                  <div className="combo-search">
                    <SearchIcon />
                    <input
                      autoFocus
                      onChange={(event) => setProductSearch(event.target.value)}
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
                        const selected = rowProductIds.has(product.id);
                        return (
                          <button
                            className={`combo-option${selected ? " selected" : ""}`}
                            key={product.id}
                            onClick={() => toggleProductRow(product.id)}
                            type="button"
                          >
                            <span className="combo-option-check">
                              {selected ? <CheckIcon /> : null}
                            </span>
                            <span>{product.name}</span>
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

            {productRows.length > 0 ? (
              <div className="sku-card-list">
                {productRows.map((row) => {
                  const product = products.find(
                    (item) => item.id === row.productId,
                  );
                  return (
                    <div className="sku-card" key={row.productId}>
                      <div className="sku-card-header">
                        <p>
                          {product ? formatProductDisplayName(product) : ""}
                        </p>
                        <button
                          aria-label={t("removeProductAria", {
                            name: product?.name ?? "",
                          })}
                          onClick={() => toggleProductRow(row.productId)}
                          type="button"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                      <div className="chip-list">
                        <button
                          aria-pressed={row.presented}
                          className={`status-chip${row.presented ? " active" : ""}`}
                          onClick={() =>
                            updateRow(row.productId, {
                              presented: !row.presented,
                            })
                          }
                          type="button"
                        >
                          {t("productPresentedChip")}
                        </button>
                        {PRODUCT_STATUS_OPTIONS.map((status) => (
                          <button
                            aria-pressed={row.status === status}
                            className={`status-chip${row.status === status ? " active" : ""}`}
                            key={status}
                            onClick={() =>
                              updateRow(row.productId, {
                                status: row.status === status ? null : status,
                              })
                            }
                            type="button"
                          >
                            {productStatusLabels[status]}
                          </button>
                        ))}
                      </div>
                      <button
                        aria-expanded={row.detailsOpen}
                        className="inline-toggle"
                        onClick={() =>
                          updateRow(row.productId, {
                            detailsOpen: !row.detailsOpen,
                          })
                        }
                        type="button"
                      >
                        {t("productDetailsToggle")}
                        <ChevronDownIcon />
                      </button>
                      {row.detailsOpen ? (
                        <>
                          <div className="sku-card-quantities">
                            <label>
                              <span>{t("skuStockLabel")}</span>
                              <input
                                inputMode="numeric"
                                onChange={(event) =>
                                  updateRow(row.productId, {
                                    stock: event.target.value,
                                  })
                                }
                                value={row.stock}
                              />
                            </label>
                            <label>
                              <span>{t("skuOrderLabel")}</span>
                              <input
                                inputMode="numeric"
                                onChange={(event) =>
                                  updateRow(row.productId, {
                                    order: event.target.value,
                                  })
                                }
                                value={row.order}
                              />
                            </label>
                            <label>
                              <span>{t("skuSaleLabel")}</span>
                              <input
                                inputMode="numeric"
                                onChange={(event) =>
                                  updateRow(row.productId, {
                                    sale: event.target.value,
                                  })
                                }
                                value={row.sale}
                              />
                            </label>
                          </div>
                          <textarea
                            onChange={(event) =>
                              updateRow(row.productId, {
                                comment: event.target.value,
                              })
                            }
                            placeholder={t("skuCommentPlaceholder")}
                            value={row.comment}
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="field-panel-card">
            <div className="field-panel-card-toggle">
              <ListTodoIcon />
              <span>{t("nextVisitTasksTitle")}</span>
              {taskEntries.length > 0 ? (
                <span className="eyebrow">
                  {t("tasksCount", { count: taskEntries.length })}
                </span>
              ) : null}
            </div>

            {taskEntries.map((entry) => (
              <div className="sku-card" key={entry.type}>
                <div className="sku-card-header">
                  <p>{taskTypeLabels[entry.type]}</p>
                  <button
                    aria-label={t("removeTaskAria", {
                      title: taskTypeLabels[entry.type],
                    })}
                    onClick={() =>
                      setTaskEntries((current) =>
                        current.filter((item) => item.type !== entry.type),
                      )
                    }
                    type="button"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <textarea
                  autoFocus={!entry.description}
                  onChange={(event) =>
                    setTaskEntries((current) =>
                      current.map((item) =>
                        item.type === entry.type
                          ? { ...item, description: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder={taskTypePlaceholders[entry.type]}
                  value={entry.description}
                />
              </div>
            ))}

            {taskEntries.length > 0 ? (
              <label>
                <span>{t("nextVisitTasksDueDate")}</span>
                <input
                  onChange={(event) => setTaskDueDate(event.target.value)}
                  type="date"
                  value={taskDueDate}
                />
              </label>
            ) : null}

            {availableTaskTypes.length > 0 ? (
              <div className="combo-field" ref={taskPickerRef}>
                <button
                  aria-expanded={taskPickerOpen}
                  className="secondary-button add-task-button"
                  onClick={() => setTaskPickerOpen((open) => !open)}
                  type="button"
                >
                  <PlusIcon />
                  {t("addTask")}
                </button>
                {taskPickerOpen ? (
                  <div className="combo-panel">
                    <div className="combo-list">
                      {availableTaskTypes.map((type) => (
                        <button
                          className="combo-option"
                          key={type}
                          onClick={() => addTaskEntry(type)}
                          type="button"
                        >
                          <span>{taskTypeLabels[type]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <label>
            <span>{t("nextActionLabel")}</span>
            <input
              onChange={(event) => setNextAction(event.target.value)}
              placeholder={t("nextActionPlaceholder")}
              value={nextAction}
            />
          </label>

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
