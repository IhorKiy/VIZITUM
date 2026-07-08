import { Prisma } from "@prisma/client";

const SERIALIZATION_FAILURE_CODE = "P2034";
const DEFAULT_MAX_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE_CODE
  );
}

/**
 * Retries a Serializable-isolation transaction on Postgres serialization
 * conflicts (Prisma P2034). Under Serializable isolation Postgres can abort
 * either side of two genuinely concurrent transactions rather than block, so
 * a conflict here doesn't mean the operation is invalid — just that it needs
 * to run again. No backoff: these are short transactions and the conflict
 * rate is low, so retrying immediately is fine.
 */
export async function withSerializationRetry<T>(
  run: () => Promise<T>,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("unreachable");
}
