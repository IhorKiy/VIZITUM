export type ApiFieldErrors = Record<string, string[]>;

export type ApiErrorResponse = {
  code: string;
  message: string;
  details?: unknown;
  fieldErrors?: ApiFieldErrors;
  requestId: string;
};
