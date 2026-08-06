import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

/**
 * Mints an id of the same shape Prisma's own `@default(cuid())` produces.
 *
 * Every model in `prisma/schema.prisma` declares `@id @default(cuid())`, and
 * Prisma 7 generates those ids **in the client** rather than in the database —
 * the `id` column is present in the INSERT it emits. Supplying `id` explicitly
 * is therefore legal and produces rows indistinguishable from the ones Prisma
 * would have minted itself.
 *
 * This exists so a batched insert can know its rows' ids *before* it writes
 * them. `createManyAndReturn` gives ids back, but correlating them to their
 * source rows means trusting that the returned order matches the VALUES order —
 * true of Postgres today, not a guarantee Prisma makes, and a silent, plausible
 * wrong answer when it fails. `applyLocationsImport` (`imports.service.ts`) is
 * the caller: a location has no column that is unique within an import file, so
 * position was the only thing left to correlate on. With ids in hand there is
 * nothing to correlate.
 *
 * Written here rather than taken from npm because the `cuid` package is
 * deprecated and unmaintained, and `@paralleldrive/cuid2` mints a *different*
 * shape — this table's ids would stop matching the ones beside them.
 *
 * The format, verified against ids Prisma actually generated (25 characters):
 *
 *     c msh8kglk 0001 rk8o f90ickws
 *     │ │        │    │    └ 8 random base36 characters
 *     │ │        │    └ 4-character fingerprint, stable for this process
 *     │ │        └ 4-character counter, base36, monotonic within the process
 *     │ └ millisecond timestamp, base36
 *     └ literal "c"
 *
 * Collision resistance comes from the same three sources cuid's own does: the
 * counter separates ids minted in the same millisecond by one process, the
 * fingerprint separates processes on one host, and the random block separates
 * hosts. Within a single import — the only thing this is used for — the counter
 * alone is sufficient.
 */
export function createCuid(): string {
  return `c${base36(Date.now(), TIMESTAMP_LENGTH)}${nextCounterBlock()}${FINGERPRINT}${randomBlock(RANDOM_LENGTH)}`;
}

const TIMESTAMP_LENGTH = 8;
const COUNTER_LENGTH = 4;
const FINGERPRINT_LENGTH = 4;
const RANDOM_LENGTH = 8;
// 36^4. The counter wraps here, which is why it is one of three sources of
// separation rather than the only one.
const COUNTER_LIMIT = 36 ** COUNTER_LENGTH;

let counter = 0;

function nextCounterBlock(): string {
  counter = (counter + 1) % COUNTER_LIMIT;

  return base36(counter, COUNTER_LENGTH);
}

// Process id plus a digest of the hostname, exactly as cuid derives it: two
// characters each, so two processes on one host and two hosts differ here even
// when their clock and counter agree.
const FINGERPRINT = buildFingerprint();

function buildFingerprint(): string {
  const processBlock = base36(process.pid, FINGERPRINT_LENGTH / 2);
  const host = hostname();
  const hostSum = [...host].reduce(
    (total, character) => total + character.charCodeAt(0),
    host.length + 36,
  );

  return `${processBlock}${base36(hostSum, FINGERPRINT_LENGTH / 2)}`;
}

// `randomBytes` rather than `Math.random`, which is what cuid used: same shape,
// and nothing about an id that appears in URLs should be predictable.
function randomBlock(length: number): string {
  let block = "";

  while (block.length < length) {
    block += randomBytes(6).readUIntBE(0, 6).toString(36);
  }

  return block.slice(0, length);
}

// Left-padded, then trimmed from the right, so a value wider than its block
// keeps its low-order characters — the ones that still vary. The timestamp
// occupies exactly 8 characters until 2059 and the counter cannot exceed its
// own limit, so only the fingerprint's host digest can reach that path.
function base36(value: number, length: number): string {
  return value.toString(36).padStart(length, "0").slice(-length);
}
