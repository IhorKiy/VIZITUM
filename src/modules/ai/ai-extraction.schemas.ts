import type { SegmentTemplate } from "@prisma/client";

type JsonSchema = {
  readonly type?: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
};

export type AiExtractionSchema = JsonSchema & {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly title: string;
};

const mentionedProductSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "status", "evidence"],
  properties: {
    name: {
      type: "string",
      description: "Product or SKU name mentioned during the visit.",
    },
    status: {
      type: "string",
      enum: ["presented", "interested", "issue", "competitor_mentioned"],
    },
    evidence: {
      type: "string",
      description:
        "Short phrase from the note or transcript supporting this extraction.",
    },
  },
} satisfies JsonSchema;

const taskToCreateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "dueDate", "assignee", "isPriority"],
  properties: {
    title: {
      type: "string",
      description: "Actionable task title for follow-up after confirmation.",
    },
    description: {
      type: "string",
      description: "Optional details that make the task executable.",
    },
    dueDate: {
      type: "string",
      description: "Optional due date in YYYY-MM-DD format.",
    },
    assignee: {
      type: "string",
      enum: ["representative", "manager", "unassigned"],
    },
    isPriority: {
      type: "boolean",
      description: "Whether this follow-up task is high priority.",
    },
  },
} satisfies JsonSchema;

const locationUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["field", "proposedValue", "reason"],
  properties: {
    field: {
      type: "string",
      enum: [
        "contact_name",
        "contact_phone",
        "contact_email",
        "address_line",
        "notes",
      ],
    },
    proposedValue: {
      type: "string",
    },
    reason: {
      type: "string",
      description: "Why the update is suggested.",
    },
  },
} satisfies JsonSchema;

const commonProperties = {
  summary: {
    type: "string",
    description: "Short visit summary in the user's working language.",
  },
  resultStatus: {
    type: "string",
    description: "Template-specific result status.",
  },
  agreements: {
    type: "array",
    items: { type: "string" },
  },
  objections: {
    type: "array",
    items: { type: "string" },
  },
  mentionedProducts: {
    type: "array",
    items: mentionedProductSchema,
  },
  nextActions: {
    type: "array",
    items: { type: "string" },
  },
  tasksToCreate: {
    type: "array",
    items: taskToCreateSchema,
  },
  locationUpdates: {
    type: "array",
    items: locationUpdateSchema,
  },
  confidence: {
    type: "number",
    minimum: 0,
    maximum: 1,
  },
  requiresUserConfirmation: {
    type: "boolean",
  },
} satisfies Record<string, JsonSchema>;

function buildSchema(
  title: string,
  resultStatuses: readonly string[],
  templateSpecificProperties: Readonly<Record<string, JsonSchema>>,
): AiExtractionSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "resultStatus",
      "agreements",
      "objections",
      "mentionedProducts",
      "nextActions",
      "tasksToCreate",
      "locationUpdates",
      "confidence",
      "requiresUserConfirmation",
      "templateSpecific",
    ],
    properties: {
      ...commonProperties,
      resultStatus: {
        type: "string",
        enum: resultStatuses,
      },
      templateSpecific: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(templateSpecificProperties),
        properties: templateSpecificProperties,
      },
    },
  };
}

export const AI_EXTRACTION_SCHEMAS = {
  distribution: buildSchema(
    "Vizitum distribution visit extraction",
    [
      "completed",
      "no_contact",
      "postponed",
      "issue_found",
      "follow_up_required",
    ],
    {
      shelfAvailabilityNotes: {
        type: "array",
        items: { type: "string" },
        description: "Availability, stock, shelf, or display findings.",
      },
      competitorMentions: {
        type: "array",
        items: { type: "string" },
      },
      merchandisingIssues: {
        type: "array",
        items: { type: "string" },
      },
      orderIntent: {
        type: "string",
        enum: ["none", "possible", "confirmed"],
      },
    },
  ),
  service: buildSchema(
    "Vizitum service visit extraction",
    [
      "completed",
      "issue_found",
      "requires_follow_up",
      "parts_required",
      "client_unavailable",
      "escalated",
    ],
    {
      workPerformed: {
        type: "array",
        items: { type: "string" },
      },
      issuesFound: {
        type: "array",
        items: { type: "string" },
      },
      partsRequired: {
        type: "array",
        items: { type: "string" },
      },
      slaRisk: {
        type: "string",
        enum: ["none", "low", "medium", "high"],
      },
    },
  ),
  partner_account: buildSchema(
    "Vizitum partner account visit extraction",
    [
      "completed",
      "agreement_reached",
      "follow_up_required",
      "objection_received",
      "postponed",
      "no_decision",
    ],
    {
      dealPotential: {
        type: "string",
        enum: ["unknown", "low", "medium", "high"],
      },
      commercialTermsDiscussed: {
        type: "array",
        items: { type: "string" },
      },
      decisionMakers: {
        type: "array",
        items: { type: "string" },
      },
      nextMeetingSuggested: {
        type: "boolean",
      },
    },
  ),
  medical: buildSchema(
    "Vizitum medical visit extraction",
    [
      "completed",
      "no_contact",
      "postponed",
      "follow_up_required",
      "objection_received",
    ],
    {
      doctorsMet: {
        type: "array",
        items: { type: "string" },
        description:
          "Doctors or medical staff spoken to, with role or specialty when stated.",
      },
      keyMessagesDelivered: {
        type: "array",
        items: { type: "string" },
        description:
          "Key product messages actually delivered during the visit.",
      },
      samplesOrMaterialsLeft: {
        type: "array",
        items: { type: "string" },
        description:
          "Samples or promotional materials left, with quantities when stated.",
      },
      prescriptionIntent: {
        type: "string",
        enum: ["none", "possible", "confirmed"],
      },
    },
  ),
} satisfies Record<SegmentTemplate, AiExtractionSchema>;

export function getAiExtractionSchema(
  segmentTemplate: SegmentTemplate,
): AiExtractionSchema {
  return AI_EXTRACTION_SCHEMAS[segmentTemplate];
}
