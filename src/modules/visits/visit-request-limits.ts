// Length ceilings on what a visit request body may *say*, as opposed to the
// byte ceilings on what it may upload (those are visit-media-limits.ts).
//
// They live here rather than in visits.service.ts for the same reason the media
// limits do: two layers have to agree on each number — the service's
// normalizers, and the class-validator DTOs the security plan's item 2.4 puts
// in front of them — and a DTO importing a Nest service module to read a
// constant would be the wrong direction of dependency for a value neither
// layer owns more than the other.

// Long enough for any UUID scheme a client might use, short enough that the
// token cannot be used to smuggle a payload into an index. Shared by the
// report's confirmation token and the device-minted visit id, because both are
// the same kind of thing — an id a device minted for work it may have to send
// twice.
export const MAX_CLIENT_REQUEST_ID_LENGTH = 128;

// The bound on a declared upload file name, checked before the name is stripped
// to its last path segment and sanitized down to 120 characters.
export const MAX_UPLOAD_FILE_NAME_LENGTH = 1_024;

// Mirrors INPUT_LIMITS.comment in apps/web/lib/input-limits.ts.
export const MAX_VISIT_CANCELLATION_COMMENT_LENGTH = 500;
