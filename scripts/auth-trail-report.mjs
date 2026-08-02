import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Reads the sign-in trail and reports what it says about credential traffic.
//
// This exists for one question the security plan asks and could not answer:
// it accepts the risk that the API answers on its own public URL — so a caller
// reaching it directly writes the leftmost `X-Forwarded-For` entry itself and
// picks the address it is rate-limited under — and names the condition for
// reopening that decision as *"when auth audit events show direct-to-API
// credential traffic"*.
//
// Read-only. Prints no email addresses and no ip hashes, only counts.
//
//   DATABASE_URL=... npm run auth:trail
//   DATABASE_URL=... npm run auth:trail -- --days 30

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const days = readDays(process.argv);
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// `--days` with nothing after it used to reach `new Date(NaN)` and surface as
// an opaque Prisma error about the filter. A window is the one input here, so
// getting it wrong should say so.
function readDays(argv) {
  const index = argv.indexOf("--days");

  if (index === -1) {
    return 7;
  }

  const value = Number(argv[index + 1]);

  if (!Number.isFinite(value) || value < 1) {
    console.error(
      `--days needs a positive number of days, got ${argv[index + 1] ?? "nothing"}.`,
    );
    process.exit(1);
  }

  return Math.floor(value);
}

// TLS is governed by the connection string, as in every other script here.
// A managed database that requires it wants `?sslmode=require` on the URL; the
// alternative — disabling certificate verification in the script — would make
// this the one place in the repo that connects to production without checking
// who answered.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const [tenantEvents, platformEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { eventType: { startsWith: "auth." }, createdAt: { gte: since } },
      select: { eventType: true, metadata: true, createdAt: true },
    }),
    prisma.platformOperationEvent.findMany({
      where: {
        eventType: {
          in: [
            "platform.login_succeeded",
            "platform.login_failed",
            "platform.logged_out",
            "platform.reauth_failed",
          ],
        },
        createdAt: { gte: since },
      },
      select: { eventType: true, metadata: true, createdAt: true },
    }),
  ]);

  const all = [...tenantEvents, ...platformEvents];

  console.log(`Sign-in trail, last ${days} day(s) — ${all.length} event(s)\n`);

  if (all.length === 0) {
    console.log(
      "Nothing recorded. Either the trail has not been deployed long enough,\nor nobody has signed in — check a successful login before concluding.",
    );
    return;
  }

  report(
    "By event and reason",
    tally(all, (event) => {
      const reason = readString(event.metadata, "reason");

      return reason ? `${event.eventType} (${reason})` : event.eventType;
    }),
  );

  // The measurement the accepted risk turns on. Traffic through the web layer
  // arrives with a characteristic chain length — that layer forwards exactly
  // one entry and the edges in front of the API append theirs — so a different
  // count is what "did not come through the web layer" looks like.
  //
  // Attacker-influenced, and therefore evidence rather than proof: a caller
  // can pad the chain. It answers the weaker question the plan actually asks.
  report(
    "Forwarded chain length (the shape that separates the two paths)",
    tally(all, (event) => {
      const hops = readString(event.metadata, "forwardedHopCount");

      return hops === undefined
        ? "not recorded (event predates this)"
        : `${hops} hop(s)`;
    }),
  );

  report(
    "Distinct sources seen (hashed, never printed)",
    new Map([
      [
        "distinct ipHash values",
        new Set(
          all
            .map((event) => readString(event.metadata, "ipHash"))
            .filter(Boolean),
        ).size,
      ],
    ]),
  );

  const failures = all.filter((event) => event.eventType.endsWith("_failed"));

  console.log(
    failures.length === 0
      ? "\nNo failed attempts in the window."
      : `\n${failures.length} failed attempt(s) in the window — read the chain-length split above:\nif failures cluster at a hop count the web layer cannot produce, that is the\ndirect-to-API traffic the plan says to reopen the decision for.`,
  );
}

function tally(events, keyOf) {
  const counts = new Map();

  for (const event of events) {
    const key = keyOf(event);

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function report(title, counts) {
  console.log(`${title}:`);

  for (const [key, count] of counts) {
    console.log(`  ${String(count).padStart(6)}  ${key}`);
  }

  console.log("");
}

function readString(metadata, key) {
  const value =
    metadata && typeof metadata === "object" ? metadata[key] : undefined;

  return typeof value === "string" ? value : undefined;
}

main()
  .catch((error) => {
    console.error("Failed:", error.message);

    if (/ssl|tls/i.test(error.message)) {
      console.error(
        "The database requires TLS — append `?sslmode=require` to DATABASE_URL.",
      );
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
