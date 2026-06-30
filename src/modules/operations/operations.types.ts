export type OperationsSummaryResponse = {
  generatedAt: string;
  windowHours: number;
  tenants: {
    total: number;
    byStatus: Record<string, number>;
  };
  provisioning: {
    queued: number;
    running: number;
    failedRecent: number;
  };
  imports: {
    failedRecent: number;
    validationFailedRecent: number;
    pendingConfirmation: number;
  };
  ai: {
    queued: number;
    running: number;
    failedRecent: number;
    expiredFailedAwaitingCleanup: number;
  };
  storage: {
    expiredTemporaryAwaitingCleanup: number;
    deletedRecent: number;
  };
};
