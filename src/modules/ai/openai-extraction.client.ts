import { Injectable } from "@nestjs/common";

import type { ExtractionInput, ExtractionResult } from "./ai.types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

@Injectable()
export class OpenAiExtractionClient {
  async extract(input: ExtractionInput, model: string): Promise<ExtractionResult> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Extract a structured visit report. Return only data that is supported by the transcript. Keep requiresUserConfirmation true.",
          },
          {
            role: "user",
            content: JSON.stringify({
              transcript: input.transcript,
              visitContext: input.visitContext ?? {},
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI extraction failed with ${response.status}.`);
    }

    const payload = (await response.json()) as { output_text?: unknown };
    const outputText = extractOutputText(payload);
    const draft = JSON.parse(outputText) as unknown;

    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      throw new Error("OpenAI extraction response did not include an object.");
    }

    return { draft: draft as Record<string, unknown> };
  }
}

function extractOutputText(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "output_text" in payload &&
    typeof payload.output_text === "string"
  ) {
    return payload.output_text;
  }

  if (!payload || typeof payload !== "object" || !("output" in payload)) {
    throw new Error("OpenAI extraction response did not include output text.");
  }

  const output = payload.output;

  if (!Array.isArray(output)) {
    throw new Error("OpenAI extraction response output was invalid.");
  }

  for (const item of output) {
    if (!hasArrayProperty(item, "content")) {
      continue;
    }

    const content = item.content;

    for (const part of content) {
      if (hasStringProperty(part, "text")) {
        return part.text;
      }
    }
  }

  throw new Error("OpenAI extraction response did not include output text.");
}

function hasArrayProperty<T extends string>(
  value: unknown,
  propertyName: T,
): value is Record<T, unknown[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    propertyName in value &&
    Array.isArray((value as Record<T, unknown>)[propertyName])
  );
}

function hasStringProperty<T extends string>(
  value: unknown,
  propertyName: T,
): value is Record<T, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    propertyName in value &&
    typeof (value as Record<T, unknown>)[propertyName] === "string"
  );
}
