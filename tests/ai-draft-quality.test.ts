import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyAiDraftQuality,
  WEAK_DRAFT_CONFIDENCE_THRESHOLD,
} from "../src/modules/ai/ai-draft-quality";

function buildCompleteDistributionDraft(): Record<string, unknown> {
  return {
    summary: "Visited the store and reviewed shelf availability.",
    resultStatus: "completed",
    agreements: [],
    objections: [],
    mentionedProducts: [],
    nextActions: [],
    tasksToCreate: [],
    locationUpdates: [],
    confidence: 0.9,
    requiresUserConfirmation: true,
    templateSpecific: {
      shelfAvailabilityNotes: [],
      competitorMentions: [],
      merchandisingIssues: [],
      orderIntent: "none",
    },
  };
}

describe("AI draft quality classification", () => {
  it("marks a complete high-confidence draft as ready to confirm", () => {
    const quality = classifyAiDraftQuality(
      buildCompleteDistributionDraft(),
      "distribution",
    );

    assert.equal(quality.state, "ready_to_confirm");
    assert.deepEqual(quality.reasons, []);
    assert.deepEqual(quality.missingRequiredFields, []);
    assert.equal(quality.confidence, 0.9);
  });

  it("marks missing extraction output as needing review", () => {
    const quality = classifyAiDraftQuality(null, "distribution");

    assert.equal(quality.state, "needs_review");
    assert.deepEqual(quality.reasons, ["extraction_output_missing"]);
  });

  it("flags missing schema-required fields including template-specific ones", () => {
    const draft = buildCompleteDistributionDraft();
    delete draft.agreements;
    (draft.templateSpecific as Record<string, unknown>).orderIntent = undefined;

    const quality = classifyAiDraftQuality(draft, "distribution");

    assert.equal(quality.state, "needs_review");
    assert.ok(quality.reasons.includes("missing_required_fields"));
    assert.deepEqual(quality.missingRequiredFields, [
      "agreements",
      "templateSpecific.orderIntent",
    ]);
  });

  it("flags confidence below the spec threshold as weak", () => {
    const draft = buildCompleteDistributionDraft();
    draft.confidence = WEAK_DRAFT_CONFIDENCE_THRESHOLD - 0.01;

    const quality = classifyAiDraftQuality(draft, "distribution");

    assert.equal(quality.state, "needs_review");
    assert.deepEqual(quality.reasons, ["low_confidence"]);
  });

  it("keeps confidence exactly at the threshold as acceptable", () => {
    const draft = buildCompleteDistributionDraft();
    draft.confidence = WEAK_DRAFT_CONFIDENCE_THRESHOLD;

    const quality = classifyAiDraftQuality(draft, "distribution");

    assert.equal(quality.state, "ready_to_confirm");
  });

  it("flags an empty summary as weak output", () => {
    const draft = buildCompleteDistributionDraft();
    draft.summary = "   ";

    const quality = classifyAiDraftQuality(draft, "distribution");

    assert.equal(quality.state, "needs_review");
    assert.deepEqual(quality.reasons, ["empty_summary"]);
  });

  it("flags a result status outside the template enum", () => {
    const draft = buildCompleteDistributionDraft();
    draft.resultStatus = "escalated";

    const quality = classifyAiDraftQuality(draft, "distribution");

    assert.equal(quality.state, "needs_review");
    assert.deepEqual(quality.reasons, ["invalid_result_status"]);
  });

  it("validates result status against the template it was extracted for", () => {
    const draft = buildCompleteDistributionDraft();
    draft.resultStatus = "issue_found";
    draft.templateSpecific = {
      workPerformed: [],
      issuesFound: [],
      partsRequired: [],
      slaRisk: "none",
    };

    const quality = classifyAiDraftQuality(draft, "service");

    assert.equal(quality.state, "ready_to_confirm");
  });
});
