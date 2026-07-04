import type { SegmentTemplate } from "@prisma/client";

import { getAiExtractionSchema } from "./ai-extraction.schemas";

// Weak-output criteria come from docs/specs/ai-quality-spec.md: missing
// schema-required fields, confidence below 0.6, empty/unusable summary or an
// invalid result status must lead the user to review or manual confirmation,
// never block visit completion.
export const WEAK_DRAFT_CONFIDENCE_THRESHOLD = 0.6;

export type AiDraftQualityReason =
  | "extraction_output_missing"
  | "missing_required_fields"
  | "empty_summary"
  | "invalid_result_status"
  | "low_confidence";

export type AiDraftQuality = {
  state: "ready_to_confirm" | "needs_review";
  reasons: AiDraftQualityReason[];
  missingRequiredFields: string[];
  confidence: number | null;
};

export function classifyAiDraftQuality(
  draft: unknown,
  segmentTemplate: SegmentTemplate,
): AiDraftQuality {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      state: "needs_review",
      reasons: ["extraction_output_missing"],
      missingRequiredFields: [],
      confidence: null,
    };
  }

  const data = draft as Record<string, unknown>;
  const schema = getAiExtractionSchema(segmentTemplate);
  const reasons: AiDraftQualityReason[] = [];
  const missingRequiredFields: string[] = [];

  for (const field of schema.required ?? []) {
    if (data[field] === undefined || data[field] === null) {
      missingRequiredFields.push(field);
    }
  }

  const templateSpecificSchema = schema.properties?.templateSpecific;
  const templateSpecific = data.templateSpecific;

  if (
    templateSpecific &&
    typeof templateSpecific === "object" &&
    !Array.isArray(templateSpecific)
  ) {
    const templateData = templateSpecific as Record<string, unknown>;

    for (const field of templateSpecificSchema?.required ?? []) {
      if (templateData[field] === undefined || templateData[field] === null) {
        missingRequiredFields.push(`templateSpecific.${field}`);
      }
    }
  }

  if (missingRequiredFields.length > 0) {
    reasons.push("missing_required_fields");
  }

  const summary = data.summary;

  if (typeof summary !== "string" || summary.trim() === "") {
    reasons.push("empty_summary");
  }

  const resultStatus = data.resultStatus;
  const allowedStatuses = schema.properties?.resultStatus?.enum ?? [];

  if (
    typeof resultStatus !== "string" ||
    !allowedStatuses.includes(resultStatus)
  ) {
    reasons.push("invalid_result_status");
  }

  const confidence =
    typeof data.confidence === "number" ? data.confidence : null;

  if (confidence !== null && confidence < WEAK_DRAFT_CONFIDENCE_THRESHOLD) {
    reasons.push("low_confidence");
  }

  return {
    state: reasons.length > 0 ? "needs_review" : "ready_to_confirm",
    reasons,
    missingRequiredFields,
    confidence,
  };
}
