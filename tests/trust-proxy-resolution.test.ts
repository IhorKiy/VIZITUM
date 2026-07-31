import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import express, { type Express } from "express";

/**
 * What Express actually does with `trust proxy`, driven through a real server.
 *
 * The unit tests around the readiness diagnostic feed it an already-resolved
 * address, so they can only pin how that value is *shaped* — they cannot
 * prove what Express would have produced. That matters here, because the
 * advice the docs give operators ("set TRUST_PROXY_HOPS to the number of
 * X-Forwarded-For entries") is a claim about Express's behaviour, and the
 * safety argument for the whole setting rests on a second one ("client
 * supplied entries are ignored"). Both are asserted here against the real
 * thing.
 */
function startProbe(hops: number): Promise<{
  request: (forwardedFor?: string) => Promise<string>;
  close: () => Promise<void>;
}> {
  const app: Express = express();

  app.set("trust proxy", hops);
  app.get("/probe", (request, response) => {
    response.json({ ip: request.ip });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;

      resolve({
        request: async (forwardedFor?: string) => {
          const response = await fetch(`http://127.0.0.1:${port}/probe`, {
            headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
          });
          const body = (await response.json()) as { ip: string };

          return body.ip;
        },
        close: () =>
          new Promise((closed) => {
            server.close(() => closed());
          }),
      });
    });
  });
}

describe("trust proxy resolution (real Express)", () => {
  let twoHops: Awaited<ReturnType<typeof startProbe>>;
  let oneHop: Awaited<ReturnType<typeof startProbe>>;

  before(async () => {
    twoHops = await startProbe(2);
    oneHop = await startProbe(1);
  });

  after(async () => {
    await twoHops.close();
    await oneHop.close();
  });

  it("resolves the client when hops matches the chain length", async () => {
    // The deployed shape: the web layer forwards the originating address and
    // the hosting edge appends the Next server's, so two entries reach an API
    // whose socket peer is the edge itself.
    assert.equal(
      await twoHops.request("203.0.113.10, 198.51.100.7"),
      "203.0.113.10",
    );
  });

  it("resolves an infrastructure address when hops is too low", async () => {
    // This is the failure the diagnostic exists to surface, and the reason it
    // is operator-only: the address handed back is internal.
    assert.equal(await oneHop.request("203.0.113.10, 10.0.0.7"), "10.0.0.7");
  });

  it("lets a direct caller choose its own address at the right hops", async () => {
    // The uncomfortable half of the setting, and why the docs qualify the
    // "hops = chain length" rule: at that value the leftmost entry is
    // authoritative, and anyone who can reach the API directly writes it.
    // Safe only where the API is unreachable except through an edge that
    // normalizes X-Forwarded-For.
    assert.equal(
      await twoHops.request("9.9.9.9, 198.51.100.7"),
      "9.9.9.9",
      "a client-supplied leftmost entry is NOT ignored at this hop count",
    );
  });

  it("hands back whatever text sat at that position, IP or not", async () => {
    // A numeric `trust proxy` compiles to `(addr, i) => i < n`; Express never
    // parses the entries. This is why the readiness diagnostic validates the
    // value before echoing it.
    assert.equal(
      await twoHops.request("<script>alert(1)</script>, 198.51.100.7"),
      "<script>alert(1)</script>",
    );
    assert.equal(await twoHops.request("unknown, 198.51.100.7"), "unknown");
  });

  it("falls back to the socket address when nothing is forwarded", async () => {
    assert.equal(await twoHops.request(), "127.0.0.1");
  });
});
