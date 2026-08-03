import { Injectable } from "@nestjs/common";
import { argon2id, hash, needsRehash, verify } from "argon2";

// Pinned explicitly so a dependency bump can't silently change what every
// password is hashed and verified against — the library defaults
// (memoryCost=65536 KiB, timeCost=3, parallelism=4) are whatever the argon2
// package happens to ship, not a value this codebase chose.
//
// Production runs on Render's free tier: 512 MB RAM and 0.1 CPU shared across
// the whole process, not granted per request. Parallelism above 1 assumes
// spare cores to shorten wall time by hashing lanes concurrently; on a tenth
// of one core there are none, so the lanes just take turns on the same sliver
// of CPU while each still holds its share of memoryCost — paying the memory
// cost of four lanes for the speed of one. And memoryCost itself is charged
// per concurrent hash: at the library default's 64 MiB, a handful of logins
// overlapping is most of the instance's RAM gone before the rest of the app
// gets any.
//
// This is OWASP's own low-memory Argon2id profile — the cheat sheet's
// alternative to m=47104/t=1/p=1 for exactly this "not much memory available"
// case — not an arbitrary weakening: parallelism=1 sidesteps the multi-lane
// cost entirely, and 19 MiB leaves room for several concurrent logins
// alongside the app itself. Measured locally (a laptop, not the Render
// instance, so the absolute numbers don't transfer): ~22ms per hash here
// against ~34ms for the library default — cheaper *and* lighter, because the
// default's parallelism buys nothing without real spare cores to spend it on.
export const PASSWORD_HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hashPassword(password: string): Promise<string> {
    return hash(password, PASSWORD_HASH_OPTIONS);
  }

  async verifyPassword(hashValue: string, password: string): Promise<boolean> {
    try {
      return await verify(hashValue, password);
    } catch {
      return false;
    }
  }

  // Called after a successful verify. An existing hash whose encoded
  // parameters no longer match PASSWORD_HASH_OPTIONS — hashed before this pin
  // existed, or before some future change to it — is re-hashed from the
  // password this same request already proved correct, so accounts migrate
  // to the current parameters as they sign in rather than needing a separate
  // migration pass. Returns null when nothing needs to change, so a login
  // that doesn't trigger a rehash costs no extra write.
  async rehashIfNeeded(
    currentHash: string,
    password: string,
  ): Promise<string | null> {
    if (!needsRehash(currentHash, PASSWORD_HASH_OPTIONS)) {
      return null;
    }

    return this.hashPassword(password);
  }
}
