import type { RequestContext } from "../modules/tenancy/request-context";

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      requestId?: string;
    }
  }
}

export {};
