import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { withSerializationRetry } from "../src/common/prisma-retry";

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction.",
    { code: "P2034", clientVersion: "7.8.0" },
  );
}

describe("withSerializationRetry", () => {
  it("retries once on a P2034 serialization failure and returns the eventual result", async () => {
    let attempts = 0;

    const result = await withSerializationRetry(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw serializationFailure();
      }

      return "ok";
    });

    assert.equal(result, "ok");
    assert.equal(attempts, 2);
  });

  it("gives up and throws after exhausting the attempt budget", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        withSerializationRetry(async () => {
          attempts += 1;
          throw serializationFailure();
        }, 3),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034",
    );

    assert.equal(attempts, 3);
  });

  it("does not retry errors that are not P2034 serialization failures", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        withSerializationRetry(async () => {
          attempts += 1;
          throw new Error("boom");
        }),
      /boom/,
    );

    assert.equal(attempts, 1);
  });
});
