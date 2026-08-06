import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiService } from "../src/modules/ai/ai.service";
import { emptyFieldReportExtractedData } from "../src/modules/ai/field-report-extraction.schema";

// `transcribeFieldReport` is the only AI path the product actually uses, and it
// swallows a provider failure on purpose — manual confirmation has to stay
// usable when AI is slow, weak or unavailable, which is a hard product
// requirement. What it did *not* do was tell anyone: both catches logged with
// `logger.log` (info level), wrote no `AiJob` row and captured nothing to
// Sentry.
//
// So an expired `OPENAI_API_KEY`, an exhausted quota or an OpenAI incident
// looked like a healthy, quiet system. Every rep got a blank form after every
// recording, typed the whole report by hand and concluded the voice feature was
// broken; the first signal anyone operating the system received was a support
// message from the pilot (audit F12).
//
// The pairing with F3 is what made it structural: `/operations/summary` reports
// three AI numbers and all three count `AiJob` rows, which this path never
// wrote — so the dashboard described in detail the asynchronous pipeline that
// nothing runs, and was blind to the one path every field report goes through.
//
// `EmailService` is the standard being met here: it also never throws, and it
// both logs at error level and persists the outcome.

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "ai.use_reporting"],
};

describe("AI outage visibility", () => {
  it("records a failed AiJob row when transcription fails, which is what the operations summary counts", async () => {
    const store = createStore();
    const service = new AiService(
      store.prisma as never,
      {
        transcribe: async () => {
          throw new Error("network down");
        },
      } as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    const result = await withStderrSilenced(() =>
      service.transcribeFieldReport(context as never, "visit-a", {
        audioObjectId: "audio-object-a",
        products: [],
      }),
    );

    // The fallback is unchanged and must stay that way.
    assert.deepEqual(result, {
      transcript: "",
      extractedData: emptyFieldReportExtractedData(),
    });

    assert.equal(store.createdAiJobs.length, 1);

    const job = store.createdAiJobs[0];

    assert.equal(job.tenantId, "tenant-a");
    // The resolved visit id, not the id the caller passed — an offline-started
    // visit arrives here under its client-minted id.
    assert.equal(job.visitId, "visit-a");
    assert.equal(job.type, "transcription");
    // `status: "failed"` is the whole point: `/operations/summary`'s
    // `aiJobs.failed` counts exactly this.
    assert.equal(job.status, "failed");
    assert.equal(job.provider, "openai");
    assert.equal(job.errorCode, "FIELD_REPORT_TRANSCRIPTION_FAILED");
    assert.match(String(job.errorMessage), /network down/);
    // Carried so `cleanupExpiredFailedAiJobs` — which filters on
    // `status: "failed"` and `expiresAt` — sweeps these rows rather than
    // letting a long outage accumulate them forever.
    assert.ok(job.expiresAt instanceof Date);
    assert.ok(job.startedAt instanceof Date);
    assert.ok(job.finishedAt instanceof Date);
  });

  it("records an extraction failure separately and still hands back the transcript", async () => {
    const store = createStore();
    const service = new AiService(
      store.prisma as never,
      { transcribe: async () => ({ text: "shelf looked fine" }) } as never,
      {
        extract: async () => {
          throw new Error("model unavailable");
        },
      } as never,
      buildS3StorageClient() as never,
    );

    const result = await withStderrSilenced(() =>
      service.transcribeFieldReport(context as never, "visit-a", {
        audioObjectId: "audio-object-a",
        products: [],
      }),
    );

    // A rep who lost only the extraction still keeps what they said, and fills
    // the form in from it.
    assert.equal(result.transcript, "shelf looked fine");
    assert.deepEqual(result.extractedData, emptyFieldReportExtractedData());

    assert.equal(store.createdAiJobs.length, 1);
    assert.equal(store.createdAiJobs[0].type, "extraction");
    assert.equal(
      store.createdAiJobs[0].errorCode,
      "FIELD_REPORT_EXTRACTION_FAILED",
    );
  });

  it("logs the failure at error level, the way the asynchronous path already did", async () => {
    const store = createStore();
    const service = new AiService(
      store.prisma as never,
      {
        transcribe: async () => {
          throw new Error("network down");
        },
      } as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    // JsonLogger sends error-level entries to stderr and everything else to
    // stdout, so the stream a line lands on *is* its level. The old
    // `logger.log` call put an AI outage on stdout beside ordinary traffic.
    const { entries, restore } = captureStderr();

    try {
      await service.transcribeFieldReport(context as never, "visit-a", {
        audioObjectId: "audio-object-a",
        products: [],
      });
    } finally {
      restore();
    }

    const jobEntry = entries.find((entry) => entry.message === "ai_job_status");

    assert.ok(jobEntry, "expected an ai_job_status entry on stderr");
    assert.equal(jobEntry.level, "error");
    assert.equal(jobEntry.status, "failed");
    assert.equal(jobEntry.errorCode, "FIELD_REPORT_TRANSCRIPTION_FAILED");
    assert.equal(jobEntry.visitId, "visit-a");
    assert.equal(jobEntry.requestId, "request-a");
  });

  it("still returns a usable manual form when recording the failure itself fails", async () => {
    // The database being unavailable is a plausible companion to an AI
    // outage, and this code runs inside a catch whose whole job is to hand
    // back a working manual form. Turning a degraded feature into a failed
    // request would be worse than the silence being fixed.
    const store = createStore({
      createAiJob: async () => {
        throw new Error("database unavailable");
      },
    });
    const service = new AiService(
      store.prisma as never,
      {
        transcribe: async () => {
          throw new Error("network down");
        },
      } as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    const result = await withStderrSilenced(() =>
      service.transcribeFieldReport(context as never, "visit-a", {
        audioObjectId: "audio-object-a",
        products: [],
      }),
    );

    assert.deepEqual(result, {
      transcript: "",
      extractedData: emptyFieldReportExtractedData(),
    });
  });
});

type CreatedAiJob = {
  tenantId: string;
  visitId: string;
  type: string;
  status: string;
  provider: string;
  errorCode: string;
  errorMessage: string;
  startedAt: Date;
  finishedAt: Date;
  expiresAt: Date;
};

function createStore(
  overrides: { createAiJob?: (args: unknown) => Promise<unknown> } = {},
) {
  const createdAiJobs: CreatedAiJob[] = [];

  return {
    createdAiJobs,
    prisma: {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          representativeUserId: "rep-a",
        }),
      },
      visitClientAlias: { findUnique: async () => null },
      storageObject: {
        findFirst: async () => ({
          id: "audio-object-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/visits/visit-a/audio/a.webm",
          contentType: "audio/webm",
        }),
      },
      visitNote: { findFirst: async () => ({ id: "note-a" }) },
      aiJob: {
        create:
          overrides.createAiJob ??
          (async ({ data }: { data: CreatedAiJob }) => {
            createdAiJobs.push(data);

            return { id: `ai-job-${createdAiJobs.length}` };
          }),
      },
    },
  };
}

function buildS3StorageClient() {
  return { downloadObject: async () => Buffer.from("fake-audio-bytes") };
}

async function withStderrSilenced<T>(run: () => Promise<T>): Promise<T> {
  const { restore } = captureStderr();

  try {
    return await run();
  } finally {
    restore();
  }
}

function captureStderr() {
  const entries: Record<string, string>[] = [];
  const original = process.stderr.write.bind(process.stderr);

  process.stderr.write = ((chunk: string | Uint8Array) => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    for (const line of text.split("\n").filter(Boolean)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Not one of ours — the test runner writes here too.
      }
    }

    return true;
  }) as typeof process.stderr.write;

  return {
    entries,
    restore: () => {
      process.stderr.write = original;
    },
  };
}
