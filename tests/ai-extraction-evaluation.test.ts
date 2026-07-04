import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  evaluateExtractionDraft,
  PILOT_ACCURACY_THRESHOLD,
  type ExtractionEvaluationExample,
} from "../src/modules/ai/ai-extraction-evaluation";
import { AI_EXTRACTION_SCHEMAS } from "../src/modules/ai/ai-extraction.schemas";

const FIXTURES_DIR = join(__dirname, "fixtures", "ai-eval");

function loadExamples(): ExtractionEvaluationExample[] {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map(
      (file) =>
        JSON.parse(
          readFileSync(join(FIXTURES_DIR, file), "utf8"),
        ) as ExtractionEvaluationExample,
    );
}

describe("AI extraction evaluation", () => {
  it("keeps an anonymized evaluation example for every MVP template", () => {
    const examples = loadExamples();
    const templates = new Set(
      examples.map((example) => example.segmentTemplate),
    );

    assert.deepEqual(
      [...templates].sort(),
      Object.keys(AI_EXTRACTION_SCHEMAS).sort(),
    );
  });

  it("uses only approved template result statuses in answer keys", () => {
    for (const example of loadExamples()) {
      const schema =
        AI_EXTRACTION_SCHEMAS[
          example.segmentTemplate as keyof typeof AI_EXTRACTION_SCHEMAS
        ];
      const allowed = schema.properties?.resultStatus?.enum ?? [];

      assert.ok(
        allowed.includes(example.expected.resultStatus as string),
        `${example.id} uses unapproved resultStatus ${String(example.expected.resultStatus)}`,
      );
    }
  });

  it("scores an exact candidate at full accuracy", () => {
    const [example] = loadExamples();
    const evaluation = evaluateExtractionDraft(
      example.expected,
      example.expected,
    );

    assert.equal(evaluation.accuracy, 1);
    assert.equal(evaluation.correctFields, evaluation.totalFields);
    assert.equal(evaluation.meetsPilotThreshold, true);
  });

  it("accepts case and list-order differences as correct", () => {
    const example = loadExamples().find(
      (candidate) => candidate.id === "service-example-1",
    );
    assert.ok(example);

    const candidate = structuredClone(example.expected) as Record<
      string,
      unknown
    >;
    candidate.nextActions = [
      "Schedule follow-up service visit",
      "ORDER REPLACEMENT PART",
    ];

    const evaluation = evaluateExtractionDraft(candidate, example.expected);

    assert.equal(evaluation.accuracy, 1);
  });

  it("counts wrong and missing fields against the pilot threshold", () => {
    const example = loadExamples().find(
      (candidate) => candidate.id === "distribution-example-1",
    );
    assert.ok(example);

    const candidate = structuredClone(example.expected) as Record<
      string,
      unknown
    >;
    candidate.resultStatus = "completed";
    delete candidate.nextActions;
    (candidate.templateSpecific as Record<string, unknown>).orderIntent =
      "confirmed";

    const evaluation = evaluateExtractionDraft(candidate, example.expected);
    const wrongFields = evaluation.fieldResults
      .filter((result) => !result.correct)
      .map((result) => result.field);

    assert.deepEqual(wrongFields, [
      "resultStatus",
      "nextActions",
      "templateSpecific.orderIntent",
    ]);
    assert.ok(evaluation.accuracy < 1);
  });

  it("fails the pilot threshold when most fields are wrong", () => {
    const example = loadExamples().find(
      (candidate) => candidate.id === "partner-account-example-1",
    );
    assert.ok(example);

    const evaluation = evaluateExtractionDraft({}, example.expected);

    assert.equal(evaluation.correctFields, 0);
    assert.equal(evaluation.meetsPilotThreshold, false);
    assert.equal(PILOT_ACCURACY_THRESHOLD, 0.8);
  });

  it("keeps fixtures anonymized: no emails, phone numbers or street addresses", () => {
    for (const file of readdirSync(FIXTURES_DIR)) {
      const content = readFileSync(join(FIXTURES_DIR, file), "utf8");

      assert.ok(
        !/[\w.+-]+@[\w-]+\.[\w.]+/.test(content),
        `${file} contains an email-like value`,
      );
      assert.ok(
        !/\+?\d[\d ()-]{8,}\d/.test(content),
        `${file} contains a phone-like value`,
      );
      assert.ok(
        !/\d+\s+(street|st\.|avenue|ave\.|vul\.|вул\.)/i.test(content),
        `${file} contains a street-address-like value`,
      );
    }
  });
});
