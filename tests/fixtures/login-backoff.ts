import {
  LoginBackoffService,
  type BackoffScope,
} from "../../src/modules/rate-limit/login-backoff.service";
import {
  MemoryAttemptStore,
  type AttemptStore,
} from "../../src/modules/rate-limit/attempt-store";

export type RecordedBackoff = {
  scope: BackoffScope;
  identity: string;
  delayMs: number;
};

// LoginBackoffService with the waiting removed. Tests that only need the
// service to exist (every login test that isn't about backoff) get a working
// instance; tests that are about backoff read `delays` to assert the curve
// without a suite that actually sleeps for twenty seconds.
export class TestLoginBackoffService extends LoginBackoffService {
  readonly delays: RecordedBackoff[] = [];
  readonly cleared: { scope: BackoffScope; identity: string }[] = [];

  constructor(store: AttemptStore = new MemoryAttemptStore()) {
    super(store);
  }

  async penalizeFailure(
    scope: BackoffScope,
    identity: string,
  ): Promise<number> {
    const delayMs = await super.penalizeFailure(scope, identity);

    this.delays.push({ scope, identity, delayMs });

    return delayMs;
  }

  async clearFailures(scope: BackoffScope, identity: string): Promise<void> {
    this.cleared.push({ scope, identity });

    await super.clearFailures(scope, identity);
  }

  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

export function createTestLoginBackoff(): TestLoginBackoffService {
  return new TestLoginBackoffService();
}
