// Separate from the module so services can import the injection token without
// pulling the module (and its ioredis/throttler imports) into their own graph.
export const ATTEMPT_STORE = Symbol("ATTEMPT_STORE");
