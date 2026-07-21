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
  ListTodoIcon,
  LoaderIcon,
  MicIcon,
  PackageIcon,
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

type ProductUpdateDraft = {
  productId: string;
  status: ProductUpdateStatus;
  stock: string;
  order: string;
  sale: string;
  comment: string;
};

type FieldVisitReportFormProps = {
  tenantSlug: string;
  visitId: string;
  locationName: string;
  locationAddress: string;
  products: Product[];
};

function todayIsoDate(): string {
  // Local date, not UTC: new Date().toISOString() would prefill yesterday
  // between 00:00 and ~03:00 Kyiv time (UTC+2/+3).
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

function createEmptyProductUpdate(productId: string): ProductUpdateDraft {
  return {
    productId,
    status: "in_stock",
    stock: "",
    order: "",
    sale: "",
    comment: "",
  };
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

function hasAnyExtractedField(data: FieldReportExtractedData): boolean {
  return (
    Boolean(data.outcome) ||
    Boolean(data.visitDate) ||
    data.productsPresented.length > 0 ||
    Boolean(data.stockStatus) ||
    Boolean(data.notes) ||
    Boolean(data.nextAction) ||
    data.productUpdates.length > 0 ||
    Boolean(data.tasks.dueDate) ||
    Boolean(data.tasks.assortment) ||
    Boolean(data.tasks.merchandising) ||
    Boolean(data.tasks.recommendation) ||
    Boolean(data.tasks.special) ||
    Boolean(data.tasks.note)
  );
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

export function FieldVisitReportForm({
  tenantSlug,
  visitId,
  locationName,
  locationAddress,
  products,
}: FieldVisitReportFormProps) {
  const t = useTranslations("field.visit");
  const router = useRouter();

  const [visitDate, setVisitDate] = useState(todayIsoDate);
  const [outcome, setOutcome] = useState<Outcome>("neutral");
  const [stockStatus, setStockStatus] = useState<StockStatus>("in_stock");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskDescriptions, setTaskDescriptions] = useState<
    Record<TaskType, string>
  >({
    assortment: "",
    merchandising: "",
    recommendation: "",
    special: "",
    note: "",
  });
  const [productUpdateDrafts, setProductUpdateDrafts] = useState<
    ProductUpdateDraft[]
  >([]);
  const [newProductUpdateId, setNewProductUpdateId] = useState("");
  const [productUpdatesOpen, setProductUpdatesOpen] = useState(false);
  const [productUpdateSearch, setProductUpdateSearch] = useState("");
  const [productUpdateDropdownOpen, setProductUpdateDropdownOpen] =
    useState(false);
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
  const productUpdateDropdownRef = useRef<HTMLDivElement>(null);

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
        productUpdateDropdownRef.current &&
        !productUpdateDropdownRef.current.contains(event.target as Node)
      ) {
        setProductUpdateDropdownOpen(false);
        setProductUpdateSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const taskTypeOptions = useMemo(
    () => [
      {
        value: "assortment" as const,
        label: t("taskAssortmentLabel"),
        placeholder: t("taskAssortmentPlaceholder"),
      },
      {
        value: "merchandising" as const,
        label: t("taskMerchandisingLabel"),
        placeholder: t("taskMerchandisingPlaceholder"),
      },
      {
        value: "recommendation" as const,
        label: t("taskRecommendationLabel"),
        placeholder: t("taskRecommendationPlaceholder"),
      },
      {
        value: "special" as const,
        label: t("taskSpecialLabel"),
        placeholder: t("taskSpecialPlaceholder"),
      },
      {
        value: "note" as const,
        label: t("taskNoteLabel"),
        placeholder: t("taskNotePlaceholder"),
      },
    ],
    [t],
  );

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function updateDraft(index: number, patch: Partial<ProductUpdateDraft>) {
    setProductUpdateDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  function addProductUpdate() {
    if (!newProductUpdateId) return;
    if (
      productUpdateDrafts.some(
        (draft) => draft.productId === newProductUpdateId,
      )
    ) {
      setError(t("duplicateSkuProductError"));
      setProductUpdateSearch("");
      setProductUpdateDropdownOpen(false);
      return;
    }

    setProductUpdateDrafts((current) => [
      ...current,
      createEmptyProductUpdate(newProductUpdateId),
    ]);
    setNewProductUpdateId("");
    setProductUpdateSearch("");
    setProductUpdateDropdownOpen(false);
    setError(null);
  }

  function applyExtractedVisitData(data: FieldReportExtractedData) {
    if (data.visitDate && isIsoDate(data.visitDate))
      setVisitDate(data.visitDate);
    if (data.outcome) setOutcome(data.outcome);
    if (data.stockStatus) setStockStatus(data.stockStatus);

    const matchedPresentedIds = matchPresentedProductIds(
      products,
      data.productsPresented,
    );
    if (matchedPresentedIds.size > 0)
      setSelectedProductIds(matchedPresentedIds);

    if (data.productUpdates.length && products.length) {
      const matchedUpdates = data.productUpdates
        .map((update) => {
          const product = findCatalogProduct(
            products,
            update.productName,
            update.productCode,
          );
          if (!product) return null;

          return {
            productId: product.id,
            status: update.status ?? "in_stock",
            stock: toDraftNumber(update.stock),
            order: toDraftNumber(update.order),
            sale: toDraftNumber(update.sale),
            comment: update.comment ?? "",
          } satisfies ProductUpdateDraft;
        })
        .filter((update): update is ProductUpdateDraft => update !== null);

      if (matchedUpdates.length > 0) {
        setProductUpdateDrafts((current) => {
          const next = [...current];
          matchedUpdates.forEach((update) => {
            const existingIndex = next.findIndex(
              (draft) => draft.productId === update.productId,
            );
            if (existingIndex >= 0) {
              next[existingIndex] = {
                ...next[existingIndex],
                status: update.status,
                stock: update.stock || next[existingIndex].stock,
                order: update.order || next[existingIndex].order,
                sale: update.sale || next[existingIndex].sale,
                comment: update.comment || next[existingIndex].comment,
              };
            } else {
              next.push(update);
            }
          });
          return next;
        });
        setProductUpdatesOpen(true);
      }
    }

    if (data.notes) setNotes(data.notes);
    if (data.nextAction) setNextAction(data.nextAction);

    if (data.tasks.dueDate && isIsoDate(data.tasks.dueDate))
      setTaskDueDate(data.tasks.dueDate);
    setTaskDescriptions((current) => ({
      assortment: data.tasks.assortment ?? current.assortment,
      merchandising: data.tasks.merchandising ?? current.merchandising,
      recommendation: data.tasks.recommendation ?? current.recommendation,
      special: data.tasks.special ?? current.special,
      note: data.tasks.note ?? current.note,
    }));
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

      if (hasAnyExtractedField(result.data.extractedData)) {
        applyExtractedVisitData(result.data.extractedData);
        setTranscriptionMessage(t("voiceAppliedNotice"));
      } else if (result.data.transcript) {
        setTranscriptionMessage(t("voiceEmptyNotice"));
      }
    } catch {
      setError(t("voiceErrorNotice"));
    } finally {
      setIsTranscribing(false);
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

    const invalidProductUpdate = productUpdateDrafts.some(
      (draft) =>
        !draft.productId ||
        hasInvalidNumber(draft.stock, draft.order, draft.sale),
    );
    if (invalidProductUpdate) {
      setError(t("invalidSkuNumbersError"));
      return;
    }

    // One accidental tap on "Save report" would otherwise permanently lock
    // the visit as completed with a content-free report — require at least
    // one real piece of the report before letting it through.
    const hasReportContent =
      Boolean(notes.trim()) ||
      Boolean(nextAction.trim()) ||
      selectedProductIds.size > 0 ||
      productUpdateDrafts.length > 0 ||
      taskTypeOptions.some((option) => taskDescriptions[option.value].trim());

    if (!hasReportContent) {
      setError(t("emptyReportError"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const selectedProducts = Array.from(selectedProductIds)
      .map((id) => products.find((product) => product.id === id))
      .filter((product): product is Product => Boolean(product));

    const productUpdates = productUpdateDrafts.map((draft) => {
      const product = products.find((item) => item.id === draft.productId);

      return {
        productId: draft.productId,
        productName: product?.name ?? "",
        productCode: product?.sku ?? null,
        status: draft.status,
        stock: parseOptionalNumber(draft.stock),
        order: parseOptionalNumber(draft.order),
        sale: parseOptionalNumber(draft.sale),
        comment: draft.comment.trim(),
      };
    });

    const mentionedProducts = [
      ...selectedProducts.map((product) => ({
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

    const tasksToCreate = taskTypeOptions
      .map((option) => ({
        title: option.label,
        description: taskDescriptions[option.value].trim(),
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
        presentedProductIds: Array.from(selectedProductIds),
        presentedProducts: selectedProducts.map((product) => ({
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
  const filteredProductUpdateOptions = products.filter((product) =>
    [product.name, product.sku, product.category].some((value) =>
      (value ?? "").toLowerCase().includes(productUpdateSearch.toLowerCase()),
    ),
  );
  const selectedProductUpdateOption =
    products.find((product) => product.id === newProductUpdateId) ?? null;

  return (
    <article className="visit-card">
      <header>
        <div>
          <h2>{t("newReportTitle")}</h2>
          <p className="visit-meta">{locationName}</p>
          <p className="visit-meta">{locationAddress}</p>
        </div>
      </header>

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

      <form className="visit-form" onSubmit={handleSubmit}>
        <div className="voice-capture">
          <p className="voice-capture-hint">
            {isRecording ? t("voiceHintRecording") : t("voiceHintIdle")}
          </p>
          <button
            aria-label={isRecording ? t("voiceStopAria") : t("voiceRecordAria")}
            className={`voice-capture-button${isRecording ? " recording" : ""}`}
            disabled={isTranscribing || isSubmitting}
            onClick={isRecording ? stopRecording : () => void startRecording()}
            type="button"
          >
            {isRecording ? <StopIcon size={28} /> : <MicIcon size={36} />}
          </button>
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

        <label>
          <span>{t("visitDateLabel")}</span>
          <input
            onChange={(event) => setVisitDate(event.target.value)}
            type="date"
            value={visitDate}
          />
        </label>

        <div className="form-row">
          <label>
            <span>{t("outcomeLabel")}</span>
            <select
              onChange={(event) => setOutcome(event.target.value as Outcome)}
              value={outcome}
            >
              <option value="positive">{t("outcomePositive")}</option>
              <option value="neutral">{t("outcomeNeutral")}</option>
              <option value="negative">{t("outcomeNegative")}</option>
            </select>
          </label>
          <label>
            <span>{t("stockStatusLabel")}</span>
            <select
              onChange={(event) =>
                setStockStatus(event.target.value as StockStatus)
              }
              value={stockStatus}
            >
              <option value="in_stock">{t("stockInStock")}</option>
              <option value="low_stock">{t("stockLowStock")}</option>
              <option value="out_of_stock">{t("stockOutOfStock")}</option>
            </select>
          </label>
        </div>

        <div>
          <div className="field-label-row">
            <span>{t("presentedProductsLabel")}</span>
            {selectedProductIds.size > 0 ? (
              <span className="eyebrow">
                {t("presentedProductsSelectedCount", {
                  count: selectedProductIds.size,
                })}
              </span>
            ) : null}
          </div>

          {selectedProductIds.size > 0 ? (
            <div className="chip-list">
              {Array.from(selectedProductIds).map((id) => {
                const product = products.find((item) => item.id === id);
                if (!product) return null;
                return (
                  <span className="chip" key={id}>
                    <span>{formatProductDisplayName(product)}</span>
                    <button
                      aria-label={t("removeProductAria", {
                        name: product.name,
                      })}
                      className="chip-remove"
                      onClick={() => toggleProduct(id)}
                      type="button"
                    >
                      <CloseIcon />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="combo-field" ref={productDropdownRef}>
            <button
              aria-expanded={productDropdownOpen}
              className="combo-trigger"
              onClick={() => setProductDropdownOpen((open) => !open)}
              type="button"
            >
              <span>
                {selectedProductIds.size > 0
                  ? t("productsSelectedShort", {
                      count: selectedProductIds.size,
                    })
                  : t("presentedProductsPlaceholder")}
              </span>
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
                    <button onClick={() => setProductSearch("")} type="button">
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
                      const selected = selectedProductIds.has(product.id);
                      return (
                        <button
                          className={`combo-option${selected ? " selected" : ""}`}
                          key={product.id}
                          onClick={() => toggleProduct(product.id)}
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
                {selectedProductIds.size > 0 ? (
                  <div className="combo-footer">
                    <span>
                      {t("presentedProductsSelectedCount", {
                        count: selectedProductIds.size,
                      })}
                    </span>
                    <button
                      onClick={() => setSelectedProductIds(new Set())}
                      type="button"
                    >
                      {t("clearSelection")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="field-panel-card">
          <button
            aria-expanded={productUpdatesOpen}
            className="field-panel-card-toggle"
            onClick={() => setProductUpdatesOpen((open) => !open)}
            type="button"
          >
            <PackageIcon />
            <span>{t("skuUpdatesTitle")}</span>
            {productUpdateDrafts.length > 0 ? (
              <span className="eyebrow">
                {t("skuUpdatesCount", { count: productUpdateDrafts.length })}
              </span>
            ) : null}
            <ChevronDownIcon />
          </button>

          {productUpdatesOpen ? (
            <>
              <div className="combo-field" ref={productUpdateDropdownRef}>
                <button
                  aria-expanded={productUpdateDropdownOpen}
                  className="combo-trigger"
                  onClick={() => setProductUpdateDropdownOpen((open) => !open)}
                  type="button"
                >
                  <span>
                    {selectedProductUpdateOption
                      ? formatProductDisplayName(selectedProductUpdateOption)
                      : t("skuUpdatesChooseProduct")}
                  </span>
                  <ChevronDownIcon />
                </button>

                {productUpdateDropdownOpen ? (
                  <div className="combo-panel">
                    <div className="combo-search">
                      <SearchIcon />
                      <input
                        autoFocus
                        onChange={(event) =>
                          setProductUpdateSearch(event.target.value)
                        }
                        placeholder={t("productSearchPlaceholder")}
                        value={productUpdateSearch}
                      />
                      {productUpdateSearch ? (
                        <button
                          onClick={() => setProductUpdateSearch("")}
                          type="button"
                        >
                          <CloseIcon />
                        </button>
                      ) : null}
                    </div>
                    <div className="combo-list">
                      {!products.length ? (
                        <p className="combo-empty">{t("productsEmpty")}</p>
                      ) : filteredProductUpdateOptions.length === 0 ? (
                        <p className="combo-empty">{t("productsNoMatch")}</p>
                      ) : (
                        filteredProductUpdateOptions.map((product) => {
                          const selected = newProductUpdateId === product.id;
                          return (
                            <button
                              className={`combo-option${selected ? " selected" : ""}`}
                              key={product.id}
                              onClick={() => {
                                setNewProductUpdateId(product.id);
                                setProductUpdateDropdownOpen(false);
                                setProductUpdateSearch("");
                              }}
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
              <button
                className="secondary-button"
                onClick={addProductUpdate}
                type="button"
              >
                {t("skuUpdatesAdd")}
              </button>

              {productUpdateDrafts.length === 0 ? (
                <p className="form-hint">{t("skuUpdatesEmpty")}</p>
              ) : (
                <div className="sku-card-list">
                  {productUpdateDrafts.map((draft, index) => {
                    const product = products.find(
                      (item) => item.id === draft.productId,
                    );
                    return (
                      <div
                        className="sku-card"
                        key={`${draft.productId}-${index}`}
                      >
                        <div className="sku-card-header">
                          <p>
                            {[product?.sku, product?.name]
                              .filter(Boolean)
                              .join(" · ") || draft.status}
                          </p>
                          <button
                            aria-label={t("removeSkuAria", {
                              name: product?.name ?? "",
                            })}
                            onClick={() =>
                              setProductUpdateDrafts((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                            type="button"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                        <label>
                          <span>{t("skuStatusLabel")}</span>
                          <select
                            onChange={(event) =>
                              updateDraft(index, {
                                status: event.target
                                  .value as ProductUpdateStatus,
                              })
                            }
                            value={draft.status}
                          >
                            <option value="in_stock">
                              {t("skuStatusInStock")}
                            </option>
                            <option value="out_of_stock">
                              {t("skuStatusOutOfStock")}
                            </option>
                            <option value="to_order">
                              {t("skuStatusToOrder")}
                            </option>
                            <option value="not_relevant">
                              {t("skuStatusNotRelevant")}
                            </option>
                          </select>
                        </label>
                        <div className="sku-card-quantities">
                          <label>
                            <span>{t("skuStockLabel")}</span>
                            <input
                              inputMode="numeric"
                              onChange={(event) =>
                                updateDraft(index, {
                                  stock: event.target.value,
                                })
                              }
                              value={draft.stock}
                            />
                          </label>
                          <label>
                            <span>{t("skuOrderLabel")}</span>
                            <input
                              inputMode="numeric"
                              onChange={(event) =>
                                updateDraft(index, {
                                  order: event.target.value,
                                })
                              }
                              value={draft.order}
                            />
                          </label>
                          <label>
                            <span>{t("skuSaleLabel")}</span>
                            <input
                              inputMode="numeric"
                              onChange={(event) =>
                                updateDraft(index, { sale: event.target.value })
                              }
                              value={draft.sale}
                            />
                          </label>
                        </div>
                        <textarea
                          onChange={(event) =>
                            updateDraft(index, { comment: event.target.value })
                          }
                          placeholder={t("skuCommentPlaceholder")}
                          value={draft.comment}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>

        <label>
          <span>{t("notesLabel")}</span>
          <textarea
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("notesPlaceholder")}
            value={notes}
          />
        </label>

        <label>
          <span>{t("nextActionLabel")}</span>
          <input
            onChange={(event) => setNextAction(event.target.value)}
            placeholder={t("nextActionPlaceholder")}
            value={nextAction}
          />
        </label>

        <div className="field-panel-card">
          <div className="field-panel-card-toggle">
            <ListTodoIcon />
            <span>{t("nextVisitTasksTitle")}</span>
          </div>
          <label>
            <span>{t("nextVisitTasksDueDate")}</span>
            <input
              onChange={(event) => setTaskDueDate(event.target.value)}
              type="date"
              value={taskDueDate}
            />
          </label>
          {taskTypeOptions.map((option) => (
            <label key={option.value}>
              <span>{option.label}</span>
              <textarea
                onChange={(event) =>
                  setTaskDescriptions((current) => ({
                    ...current,
                    [option.value]: event.target.value,
                  }))
                }
                placeholder={option.placeholder}
                value={taskDescriptions[option.value]}
              />
            </label>
          ))}
        </div>

        <button
          className="primary-button field-report-submit"
          disabled={isSubmitting || isRecording || isTranscribing}
          type="submit"
        >
          {isSubmitting ? <LoaderIcon /> : <SaveIcon />}
          {isSubmitting ? t("saving") : t("saveReport")}
        </button>
      </form>
    </article>
  );
}
