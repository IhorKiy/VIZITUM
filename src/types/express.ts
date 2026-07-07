import type { RequestContext } from "../modules/tenancy/request-context";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmenting Express.Request requires the ambient namespace form.
  namespace Express {
    interface Request {
      context?: RequestContext;
      requestId?: string;
    }
  }
}

export {};
