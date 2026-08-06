// Size ceilings for visit media, shared by the two paths that have to agree on
// them: registration, which validates the size a client *declares* before
// minting a presigned PUT, and the server-side download that later reads the
// object back.
//
// Sharing them is the point, and both checks are real ones. The presigned PUT
// signs `Content-Length` (`storage/s3-storage.client.ts`), and a browser
// computes that header from the body it actually sends rather than letting a
// caller set it — so a body larger than the size declared at registration fails
// the PUT itself. The declared number is a gate, not a claim. `storage.service`
// passes it on every upload and refuses outright to sign an object whose size
// is unknown, so no path produces an unsigned upload;
// `tests/storage-signed-url.test.ts` and `tests/storage-service.test.ts` pin
// both halves.
//
// The download applies the same ceiling again, against the length the *store*
// reports — the only authority on what was actually stored, and worth its own
// check because that read buffers the whole object into memory
// (`tests/storage-download-size-cap.test.ts`).
//
// This comment used to say the opposite: that the PUT signed nothing, so
// registration bounded a claim and only the read side was real. That stopped
// being true with item 3.2 of `docs/security-remediation-plan.md`. Recorded
// rather than quietly corrected, because the reason to state any of this is
// that understating a shipped control is how the control later gets deleted as
// redundant (audit F9).
export const MAX_TEMPORARY_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_PROBLEM_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
