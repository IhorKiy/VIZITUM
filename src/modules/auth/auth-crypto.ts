import { createHash } from "node:crypto";

import { HASH_ALGORITHM } from "./auth.constants";

export function hashValue(value: string): string {
  return createHash(HASH_ALGORITHM).update(value).digest("hex");
}
