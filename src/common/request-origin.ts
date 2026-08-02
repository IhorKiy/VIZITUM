import type { Request } from "express";

import { hashValue } from "../modules/auth/auth-crypto";

/**
 * Where a request appeared to come from, for the sign-in trail.
 *
 * The security plan records an accepted risk — the API answers on its own
 * public URL, so a caller reaching it directly writes the leftmost
 * `X-Forwarded-For` entry itself and chooses the address it is rate-limited
 * under — and names the condition for revisiting it: *when the auth audit
 * events land and show direct-to-API credential traffic*. Those events landed
 * without recording anything that could show it, which left the condition
 * unmeasurable. This is what makes it measurable.
 *
 * **A measurement, not a control.** Both fields are attacker-influenced: a
 * caller can pad the forwarded chain and can vary its address. Someone
 * deliberately imitating the web layer's shape will not stand out. What this
 * answers is the weaker and still useful question — is there credential
 * traffic that does not look like it came through the web layer — which is
 * exactly what the plan asks before reopening the decision.
 */
export type RequestOrigin = {
  /**
   * SHA-256 of the address Express resolved, matching `sessions.ipHash` so the
   * two can be joined. Hashed for the same reason that column is: the trail
   * should support "was this the same source" without becoming a list of
   * addresses.
   */
  ipHash?: string;
  /**
   * Entries in `X-Forwarded-For`. Traffic through the web layer arrives with a
   * characteristic count — that layer forwards exactly one entry and the edges
   * in front of the API append their own — so a different count is the signal
   * worth counting.
   */
  forwardedHopCount: number;
};

export function describeRequestOrigin(request: Request): RequestOrigin {
  const forwardedFor = request.header("x-forwarded-for") ?? "";
  const forwardedHopCount = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean).length;
  const address = request.ip?.trim();

  return {
    ...(address ? { ipHash: hashValue(address) } : {}),
    forwardedHopCount,
  };
}
