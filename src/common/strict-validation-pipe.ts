import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
} from "@nestjs/common";

/**
 * The scoped alternative to the global ValidationPipe this codebase
 * deliberately does not register (see item 2.4 in
 * docs/security-remediation-plan.md: a global `whitelist: true` would strip
 * every request body, since most controllers still type `@Body()` against
 * plain interfaces rather than a class-validator DTO). Attach this per
 * controller or per route — via `@UsePipes()` — once that route's body has a
 * real DTO, so whitelist/forbidNonWhitelisted only ever apply where a DTO
 * defines what "whitelisted" means.
 *
 * The error shape matches the rest of the API (`code`, `message`,
 * `fieldErrors`) instead of Nest's default `{ message: string[] }`, so
 * `ApiErrorFilter` needs no special case for it.
 */
export function createStrictValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed.",
        fieldErrors: toFieldErrors(errors),
      }),
  });
}

function toFieldErrors(errors: ValidationError[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const error of errors) {
    const messages = error.constraints ? Object.values(error.constraints) : [];

    if (messages.length) {
      fieldErrors[error.property] = messages;
    }
  }

  return fieldErrors;
}
