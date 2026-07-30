import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI_EXTRACTION_SCHEMAS } from "../src/modules/ai/ai-extraction.schemas";
import { AiService } from "../src/modules/ai/ai.service";

describe("AI extraction schemas", () => {
  it("defines schemas for all MVP segment templates", () => {
    assert.deepEqual(Object.keys(AI_EXTRACTION_SCHEMAS).sort(), [
      "distribution",
      "medical",
      "partner_account",
      "service",
    ]);
  });

  it("keeps extraction output strict and user-confirmed", () => {
    for (const schema of Object.values(AI_EXTRACTION_SCHEMAS)) {
      assert.equal(schema.additionalProperties, false);
      assert.ok(schema.required.includes("requiresUserConfirmation"));
      assert.ok(schema.required.includes("templateSpecific"));
      assert.equal(
        schema.properties?.templateSpecific?.additionalProperties,
        false,
      );
    }
  });

  it("exposes template-specific statuses through the AI service", () => {
    const service = new AiService();
    const distributionSchema = service.getExtractionSchema("distribution");
    const partnerSchema = service.getExtractionSchema("partner_account");

    assert.deepEqual(distributionSchema.properties?.resultStatus?.enum, [
      "completed",
      "no_contact",
      "postponed",
      "issue_found",
      "follow_up_required",
    ]);
    assert.deepEqual(partnerSchema.properties?.resultStatus?.enum, [
      "completed",
      "agreement_reached",
      "follow_up_required",
      "objection_received",
      "postponed",
      "no_decision",
    ]);

    const medicalSchema = service.getExtractionSchema("medical");
    assert.deepEqual(medicalSchema.properties?.resultStatus?.enum, [
      "completed",
      "no_contact",
      "postponed",
      "follow_up_required",
      "objection_received",
    ]);
    assert.deepEqual(
      Object.keys(medicalSchema.properties?.templateSpecific?.properties ?? {}),
      [
        "doctorsMet",
        "keyMessagesDelivered",
        "samplesOrMaterialsLeft",
        "prescriptionIntent",
      ],
    );
  });
});
