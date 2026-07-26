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

export const FIELD_REPORT_EXTRACTION_SCHEMA: FieldReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "orderPlaced",
    "noOrderReason",
    "visitDate",
    "notes",
    "nextAction",
    "nextActionDueDate",
    "missingProducts",
    "problemType",
    "problemNote",
  ],
  properties: {
    orderPlaced: { type: ["boolean", "null"] },
    noOrderReason: {
      type: ["string", "null"],
      enum: [
        "closed",
        "no_decision_maker",
        "has_stock",
        "no_money",
        "refused",
        "other",
        null,
      ],
    },
    visitDate: {
      type: ["string", "null"],
      description: "YYYY-MM-DD",
    },
    missingProducts: {
      type: "array",
      items: { type: "string" },
      description:
        "Product or SKU names the transcript says were absent from the shelf.",
    },
    notes: { type: ["string", "null"] },
    nextAction: {
      type: ["string", "null"],
      description:
        "The single commitment for the next visit, in the speaker's own words.",
    },
    nextActionDueDate: {
      type: ["string", "null"],
      description: "YYYY-MM-DD",
    },
    problemType: {
      type: ["string", "null"],
      enum: ["return", "damaged", "expired", "conflict", null],
    },
    problemNote: { type: ["string", "null"] },
  },
};

export const FIELD_REPORT_EXTRACTION_SCHEMA_NAME =
  "field_report_visit_extraction";

export const FIELD_REPORT_EXTRACTION_SYSTEM_PROMPT = `You are a field sales representative assistant for visit reports.
Extract structured data from a visit report transcript. Return a JSON object with this shape:
{
  "orderPlaced": boolean | null,
  "noOrderReason": "closed" | "no_decision_maker" | "has_stock" | "no_money" | "refused" | "other" | null,
  "visitDate": "YYYY-MM-DD" | null,
  "notes": string | null,
  "nextAction": string | null,
  "nextActionDueDate": "YYYY-MM-DD" | null,
  "missingProducts": string[],
  "problemType": "return" | "damaged" | "expired" | "conflict" | null,
  "problemNote": string | null
}

Field guidance:
- orderPlaced is the visit result as a fact: true when the visit produced an order, false when it did not. Use null only when the transcript does not say either way — never guess from the speaker's tone.
- noOrderReason explains a visit with no order, and stays null when orderPlaced is true or unknown: "closed" (the outlet was shut), "no_decision_maker" (nobody who can order was there), "has_stock" (the outlet still has stock), "no_money" (the outlet cannot pay right now), "refused" (the outlet declined to order), "other" (a stated reason none of the above cover).
- missingProducts lists only the products the transcript says were absent, out of stock or sold out at this outlet. Leave it empty when the transcript merely mentions or presents a product without saying it was missing.
- nextAction is the one thing agreed for the next visit — what the rep promised to bring or do, or when to come back ("bring the coffee price list", "the owner is in on Tuesday after 2pm"). It becomes the follow-up task, so keep it to a single sentence; if several commitments are mentioned, use the one the speaker treats as the reason to come back.
- nextActionDueDate is the date that commitment is due, only when the transcript states or clearly implies one.
- problemType and problemNote record a problem only when the transcript reports one: "return" (goods going back), "damaged" (broken or unsellable stock), "expired" (stock past its date), "conflict" (a dispute with the outlet). Both stay null for an ordinary visit — a visit with nothing wrong must not produce a problem record. problemNote is the couple of words describing it, in the speaker's own wording.
- Prefer product names/codes from the provided product catalog when the transcript matches one closely. If a spoken product is not in the catalog, keep the spoken name.
- Do not invent quantities, dates, products, commitments, or comments. Use null or [] when something is not mentioned.
- Preserve the transcript's own wording and language for notes, nextAction and comments.

Respond only with the JSON object described above.`;

export type FieldReportNoOrderReason =
  | "closed"
  | "no_decision_maker"
  | "has_stock"
  | "no_money"
  | "refused"
  | "other";

export type FieldReportProblemType =
  "return" | "damaged" | "expired" | "conflict";

export type FieldReportExtractedData = {
  orderPlaced: boolean | null;
  noOrderReason: FieldReportNoOrderReason | null;
  visitDate: string | null;
  notes: string | null;
  nextAction: string | null;
  nextActionDueDate: string | null;
  missingProducts: string[];
  problemType: FieldReportProblemType | null;
  problemNote: string | null;
};

export function emptyFieldReportExtractedData(): FieldReportExtractedData {
  return {
    orderPlaced: null,
    noOrderReason: null,
    visitDate: null,
    notes: null,
    nextAction: null,
    nextActionDueDate: null,
    missingProducts: [],
    problemType: null,
    problemNote: null,
  };
}

export function normalizeFieldReportExtraction(
  value: unknown,
): FieldReportExtractedData {
  if (!isRecord(value)) {
    return emptyFieldReportExtractedData();
  }

  const orderPlaced = normalizeBoolean(value.orderPlaced);

  return {
    orderPlaced,
    // A reason only ever qualifies a visit that produced no order. Dropping
    // it otherwise keeps a model that answers both fields at once from
    // producing a draft the form can't represent.
    noOrderReason:
      orderPlaced === false
        ? normalizeEnum(value.noOrderReason, [
            "closed",
            "no_decision_maker",
            "has_stock",
            "no_money",
            "refused",
            "other",
          ] as const)
        : null,
    visitDate: normalizeDate(value.visitDate),
    notes: normalizeString(value.notes),
    nextAction: normalizeString(value.nextAction),
    nextActionDueDate: normalizeDate(value.nextActionDueDate),
    missingProducts: normalizeStringArray(value.missingProducts),
    problemType: normalizeEnum(value.problemType, [
      "return",
      "damaged",
      "expired",
      "conflict",
    ] as const),
    problemNote: normalizeString(value.problemNote),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
