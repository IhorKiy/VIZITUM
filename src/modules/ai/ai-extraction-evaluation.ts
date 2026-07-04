// Evaluation harness for AI extraction quality per docs/specs/ai-quality-spec.md:
// candidate drafts are scored field-by-field against an expected answer key
// built from the approved report-template fields, with a pragmatic 80%
// required-field accuracy threshold for the first pilot.
export const PILOT_ACCURACY_THRESHOLD = 0.8;

export type ExtractionFieldResult = {
  field: string;
  expected: unknown;
  actual: unknown;
  correct: boolean;
};

export type ExtractionEvaluation = {
  totalFields: number;
  correctFields: number;
  accuracy: number;
  meetsPilotThreshold: boolean;
  fieldResults: ExtractionFieldResult[];
};

export type ExtractionEvaluationExample = {
  id: string;
  segmentTemplate: string;
  description: string;
  expected: Record<string, unknown>;
};

export function evaluateExtractionDraft(
  candidate: unknown,
  expected: Record<string, unknown>,
): ExtractionEvaluation {
  const data =
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};
  const fieldResults: ExtractionFieldResult[] = [];

  collectFieldResults(fieldResults, "", expected, data);

  const correctFields = fieldResults.filter((result) => result.correct).length;
  const accuracy =
    fieldResults.length > 0 ? correctFields / fieldResults.length : 0;

  return {
    totalFields: fieldResults.length,
    correctFields,
    accuracy,
    meetsPilotThreshold: accuracy >= PILOT_ACCURACY_THRESHOLD,
    fieldResults,
  };
}

function collectFieldResults(
  results: ExtractionFieldResult[],
  prefix: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const field = prefix ? `${prefix}.${key}` : key;
    const actualValue = actual[key];

    if (
      expectedValue &&
      typeof expectedValue === "object" &&
      !Array.isArray(expectedValue)
    ) {
      const actualObject =
        actualValue &&
        typeof actualValue === "object" &&
        !Array.isArray(actualValue)
          ? (actualValue as Record<string, unknown>)
          : {};

      collectFieldResults(
        results,
        field,
        expectedValue as Record<string, unknown>,
        actualObject,
      );

      continue;
    }

    results.push({
      field,
      expected: expectedValue,
      actual: actualValue,
      correct: valuesMatch(expectedValue, actualValue),
    });
  }
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }

    // Extraction list order is not meaningful for evaluation: agreed items,
    // mentioned products or issues count as correct regardless of ordering.
    const remaining: unknown[] = [...(actual as unknown[])];

    return expected.every((expectedItem) => {
      const index = remaining.findIndex((actualItem) =>
        deepEquals(expectedItem, actualItem),
      );

      if (index === -1) {
        return false;
      }

      remaining.splice(index, 1);

      return true;
    });
  }

  return deepEquals(expected, actual);
}

function deepEquals(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "string" && typeof actual === "string") {
    return normalizeText(expected) === normalizeText(actual);
  }

  if (Array.isArray(expected)) {
    return valuesMatch(expected, actual);
  }

  if (
    expected &&
    actual &&
    typeof expected === "object" &&
    typeof actual === "object"
  ) {
    const expectedEntries = Object.entries(expected as Record<string, unknown>);
    const actualObject = actual as Record<string, unknown>;

    return (
      expectedEntries.length === Object.keys(actualObject).length &&
      expectedEntries.every(([key, value]) =>
        deepEquals(value, actualObject[key]),
      )
    );
  }

  return expected === actual;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
