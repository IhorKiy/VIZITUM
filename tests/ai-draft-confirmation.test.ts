import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiService } from "../src/modules/ai/ai.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [
    "visits.update_own",
    "reports.confirm_own",
    "ai.use_reporting",
  ],
};

const createdAt = new Date("2026-06-29T10:00:00.000Z");

describe("AI draft confirmation", () => {
  it("confirms an extraction draft into a report and tasks", async () => {
    const operations: unknown[] = [];
    const draft = {
      summary: "Confirmed visit summary",
      resultStatus: "completed",
      agreements: [],
      objections: [],
      mentionedProducts: [],
      nextActions: ["Call buyer"],
      tasksToCreate: [
        {
          title: "Call buyer",
          description: "Agree next order",
          dueDate: "2026-07-05",
          assignee: "representative",
          priority: "high",
        },
      ],
      locationUpdates: [],
      confidence: 0.88,
      requiresUserConfirmation: true,
      templateSpecific: {
        shelfAvailabilityNotes: [],
        competitorMentions: [],
        merchandisingIssues: [],
        orderIntent: "possible",
      },
    };
    const baseJob = {
      id: "extraction-job-a",
      tenantId: "tenant-a",
      visitId: "visit-a",
      type: "extraction",
      status: "succeeded",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "extraction.v1",
      schemaVersion: "visit-extraction.v1",
      inputObjectId: "transcript-object-a",
      temporaryTranscriptObjectId: null,
      temporaryDraft: draft,
      errorCode: null,
      errorMessage: null,
      startedAt: createdAt,
      finishedAt: createdAt,
      expiresAt: new Date("2026-06-30T10:00:00.000Z"),
      createdAt,
      updatedAt: createdAt,
      visit: {
        id: "visit-a",
        tenantId: "tenant-a",
        locationId: "location-a",
        representativeUserId: "rep-a",
        routeItemId: "route-item-a",
        visitType: "planned",
        status: "in_progress",
        startedAt: createdAt,
        completedAt: null,
        cancelledAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    };
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "visit-extraction.v1",
      status: "confirmed",
      confirmedData: draft,
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: {
        source: "ai_draft",
        extractionJobId: "extraction-job-a",
      },
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      aiJob: {
        findFirst: async () => baseJob,
      },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      task: {
        findMany: async (query: unknown) => {
          operations.push({ createdTasksFindMany: query });

          return [
            {
              id: "task-a",
              title: "Call buyer",
              status: "open",
              priority: "high",
              assignedToUserId: "rep-a",
              dueDate: new Date("2026-07-05T00:00:00.000Z"),
            },
          ];
        },
      },
      $transaction: async (
        callback: (transaction: {
          report: { upsert: (query: unknown) => Promise<typeof report> };
          visit: { update: (query: unknown) => Promise<void> };
          routeItem: { update: (query: unknown) => Promise<void> };
          task: {
            deleteMany: (query: unknown) => Promise<void>;
            createMany: (query: unknown) => Promise<void>;
          };
          aiJob: {
            findMany: (query: unknown) => Promise<
              {
                id: string;
                inputObjectId: string | null;
                temporaryTranscriptObjectId: string | null;
              }[]
            >;
            updateMany: (query: unknown) => Promise<void>;
          };
          storageObject: {
            updateMany: (query: unknown) => Promise<void>;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          report: {
            upsert: async (query: unknown) => {
              operations.push({ reportUpsert: query });

              return report;
            },
          },
          visit: {
            update: async (query: unknown) => {
              operations.push({ visitUpdate: query });
            },
          },
          routeItem: {
            update: async (query: unknown) => {
              operations.push({ routeItemUpdate: query });
            },
          },
          task: {
            deleteMany: async (query: unknown) => {
              operations.push({ taskDeleteMany: query });
            },
            createMany: async (query: unknown) => {
              operations.push({ taskCreateMany: query });
            },
          },
          aiJob: {
            findMany: async (query: unknown) => {
              operations.push({ aiJobFindMany: query });

              return [
                {
                  id: "transcription-job-a",
                  inputObjectId: "audio-object-a",
                  temporaryTranscriptObjectId: "transcript-object-a",
                },
                {
                  id: "extraction-job-a",
                  inputObjectId: "transcript-object-a",
                  temporaryTranscriptObjectId: null,
                },
              ];
            },
            updateMany: async (query: unknown) => {
              operations.push({ aiJobUpdateMany: query });
            },
          },
          storageObject: {
            updateMany: async (query: unknown) => {
              operations.push({ storageObjectUpdateMany: query });
            },
          },
        }),
    };
    const service = new AiService(prisma as never, {} as never, {} as never);

    const response = await service.confirmAiDraft(
      context as never,
      "visit-a",
      "extraction-job-a",
    );

    assert.equal(response.report.id, "report-a");
    assert.equal(response.createdTaskCount, 1);
    assert.equal(response.report.createdTaskCount, 1);
    assert.equal(response.report.createdTasks.length, 1);
    assert.equal(response.report.createdTasks[0].title, "Call buyer");
    assert.equal(operations.length, 9);
    const taskCreate = operations.find(
      (operation): operation is { taskCreateMany: { data: unknown[] } } =>
        typeof operation === "object" &&
        operation !== null &&
        "taskCreateMany" in operation,
    );

    assert.equal(taskCreate?.taskCreateMany.data.length, 1);
    assert.deepEqual(taskCreate?.taskCreateMany.data[0], {
      tenantId: "tenant-a",
      title: "Call buyer",
      description: "Agree next order",
      priority: "high",
      assignedToUserId: "rep-a",
      createdByUserId: "rep-a",
      locationId: "location-a",
      visitId: "visit-a",
      reportId: "report-a",
      dueDate: new Date("2026-07-05T00:00:00.000Z"),
    });

    const storageCleanup = operations.find(
      (
        operation,
      ): operation is {
        storageObjectUpdateMany: { data: { status: string }; where: unknown };
      } =>
        typeof operation === "object" &&
        operation !== null &&
        "storageObjectUpdateMany" in operation,
    );
    const jobCleanup = operations.find(
      (
        operation,
      ): operation is {
        aiJobUpdateMany: { data: { temporaryDraft: unknown } };
      } =>
        typeof operation === "object" &&
        operation !== null &&
        "aiJobUpdateMany" in operation,
    );

    assert.equal(storageCleanup?.storageObjectUpdateMany.data.status, "expired");
    assert.ok(jobCleanup?.aiJobUpdateMany.data.temporaryDraft);
  });
});
