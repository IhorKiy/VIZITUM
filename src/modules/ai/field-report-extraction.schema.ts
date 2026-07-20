// Structured extraction contract for the synchronous field visit-report
// voice flow (visits/:visitId/ai/field-report-transcriptions). Unlike
// ai-extraction.schemas.ts (segment-template extraction feeding the async
// AiJob pipeline), this schema is SKU/task oriented and always runs
// synchronously in one request — it never touches the AiJob table.

type FieldReportJsonSchema = {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly enum?: readonly (string | null)[];
  readonly properties?: Readonly<Record<string, FieldReportJsonSchema>>;
  readonly items?: FieldReportJsonSchema;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

const productUpdateSchema: FieldReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "productName",
    "productCode",
    "status",
    "stock",
    "order",
    "sale",
    "comment",
  ],
  properties: {
    productName: { type: ["string", "null"] },
    productCode: { type: ["string", "null"] },
    status: {
      type: ["string", "null"],
      enum: ["in_stock", "out_of_stock", "to_order", "not_relevant", null],
    },
    stock: { type: ["integer", "null"] },
    order: { type: ["integer", "null"] },
    sale: { type: ["integer", "null"] },
    comment: { type: ["string", "null"] },
  },
};

const tasksSchema: FieldReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "dueDate",
    "assortment",
    "merchandising",
    "recommendation",
    "special",
    "note",
  ],
  properties: {
    dueDate: { type: ["string", "null"] },
    assortment: { type: ["string", "null"] },
    merchandising: { type: ["string", "null"] },
    recommendation: { type: ["string", "null"] },
    special: { type: ["string", "null"] },
    note: { type: ["string", "null"] },
  },
};

export const FIELD_REPORT_EXTRACTION_SCHEMA: FieldReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "visitDate",
    "productsPresented",
    "stockStatus",
    "notes",
    "nextAction",
    "productUpdates",
    "tasks",
  ],
  properties: {
    outcome: {
      type: ["string", "null"],
      enum: ["positive", "neutral", "negative", null],
    },
    visitDate: {
      type: ["string", "null"],
      description: "YYYY-MM-DD",
    },
    productsPresented: {
      type: "array",
      items: { type: "string" },
      description: "Product or SKU names presented during the visit.",
    },
    stockStatus: {
      type: ["string", "null"],
      enum: ["in_stock", "low_stock", "out_of_stock", null],
    },
    notes: { type: ["string", "null"] },
    nextAction: { type: ["string", "null"] },
    productUpdates: {
      type: "array",
      items: productUpdateSchema,
      description: "SKU-level stock/order/sale facts mentioned in the note.",
    },
    tasks: tasksSchema,
  },
};

export const FIELD_REPORT_EXTRACTION_SCHEMA_NAME =
  "field_report_visit_extraction";

export const FIELD_REPORT_EXTRACTION_SYSTEM_PROMPT = `You are a field sales representative assistant for visit reports.
Extract structured data from a visit report transcript. Return a JSON object with this shape:
{
  "outcome": "positive" | "neutral" | "negative" | null,
  "visitDate": "YYYY-MM-DD" | null,
  "productsPresented": string[],
  "stockStatus": "in_stock" | "low_stock" | "out_of_stock" | null,
  "notes": string | null,
  "nextAction": string | null,
  "productUpdates": [
    {
      "productName": string | null,
      "productCode": string | null,
      "status": "in_stock" | "out_of_stock" | "to_order" | "not_relevant" | null,
      "stock": integer | null,
      "order": integer | null,
      "sale": integer | null,
      "comment": string | null
    }
  ],
  "tasks": {
    "dueDate": "YYYY-MM-DD" | null,
    "assortment": string | null,
    "merchandising": string | null,
    "recommendation": string | null,
    "special": string | null,
    "note": string | null
  }
}

Field guidance:
- outcome is the overall visit result.
- productsPresented lists products that were presented during the visit.
- stockStatus is the general location-level stock status.
- productUpdates are SKU-level facts: stock on hand, order quantity, sale quantity, status, and a comment.
- tasks are follow-up tasks for the next visit: assortment/stock, merchandising, recommendation with feature-benefit-value, a special task, and a location-specific note.
- Prefer product names/codes from the provided product catalog when the transcript matches one closely. If a spoken product is not in the catalog, keep the spoken name.
- Do not invent quantities, dates, products, tasks, or comments. Use null, [], or the empty object shape when something is not mentioned.
- Preserve the transcript's own wording and language for notes, nextAction, comments, and tasks.

Respond only with the JSON object described above.`;

export type FieldReportProductUpdateDraft = {
  productName: string | null;
  productCode: string | null;
  status: "in_stock" | "out_of_stock" | "to_order" | "not_relevant" | null;
  stock: number | null;
  order: number | null;
  sale: number | null;
  comment: string | null;
};

export type FieldReportExtractedTasks = {
  dueDate: string | null;
  assortment: string | null;
  merchandising: string | null;
  recommendation: string | null;
  special: string | null;
  note: string | null;
};

export type FieldReportExtractedData = {
  outcome: "positive" | "neutral" | "negative" | null;
  visitDate: string | null;
  productsPresented: string[];
  stockStatus: "in_stock" | "low_stock" | "out_of_stock" | null;
  notes: string | null;
  nextAction: string | null;
  productUpdates: FieldReportProductUpdateDraft[];
  tasks: FieldReportExtractedTasks;
};

export function emptyFieldReportExtractedData(): FieldReportExtractedData {
  return {
    outcome: null,
    visitDate: null,
    productsPresented: [],
    stockStatus: null,
    notes: null,
    nextAction: null,
    productUpdates: [],
    tasks: emptyFieldReportTasks(),
  };
}

function emptyFieldReportTasks(): FieldReportExtractedTasks {
  return {
    dueDate: null,
    assortment: null,
    merchandising: null,
    recommendation: null,
    special: null,
    note: null,
  };
}

export function normalizeFieldReportExtraction(
  value: unknown,
): FieldReportExtractedData {
  if (!isRecord(value)) {
    return emptyFieldReportExtractedData();
  }

  return {
    outcome: normalizeEnum(value.outcome, [
      "positive",
      "neutral",
      "negative",
    ] as const),
    visitDate: normalizeDate(value.visitDate),
    productsPresented: normalizeStringArray(value.productsPresented),
    stockStatus: normalizeEnum(value.stockStatus, [
      "in_stock",
      "low_stock",
      "out_of_stock",
    ] as const),
    notes: normalizeString(value.notes),
    nextAction: normalizeString(value.nextAction),
    productUpdates: normalizeProductUpdates(value.productUpdates),
    tasks: normalizeTasks(value.tasks),
  };
}

function normalizeProductUpdates(
  value: unknown,
): FieldReportProductUpdateDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): FieldReportProductUpdateDraft | null => {
      if (!isRecord(item)) {
        return null;
      }

      const productName = normalizeString(item.productName);
      const productCode = normalizeString(item.productCode);

      if (!productName && !productCode) {
        return null;
      }

      return {
        productName,
        productCode,
        status: normalizeEnum(item.status, [
          "in_stock",
          "out_of_stock",
          "to_order",
          "not_relevant",
        ] as const),
        stock: normalizeNonNegativeInteger(item.stock),
        order: normalizeNonNegativeInteger(item.order),
        sale: normalizeNonNegativeInteger(item.sale),
        comment: normalizeString(item.comment),
      };
    })
    .filter((item): item is FieldReportProductUpdateDraft => item !== null);
}

function normalizeTasks(value: unknown): FieldReportExtractedTasks {
  if (!isRecord(value)) {
    return emptyFieldReportTasks();
  }

  return {
    dueDate: normalizeDate(value.dueDate),
    assortment: normalizeString(value.assortment),
    merchandising: normalizeString(value.merchandising),
    recommendation: normalizeString(value.recommendation),
    special: normalizeString(value.special),
    note: normalizeString(value.note),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => item !== null);
}

function normalizeDate(value: unknown): string | null {
  const text = normalizeString(value);

  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
