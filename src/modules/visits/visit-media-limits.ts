// Size ceilings for visit media, shared by the two paths that have to agree on
// them: registration, which validates the size a client *declares* before
// minting a presigned PUT, and the server-side download that later reads the
// object back.
//
// Sharing them is the point. The declared size is caller-supplied and the
// presigned PUT does not sign `Content-Length`, so nothing stops a caller
// declaring one number and uploading another — the registration check bounds a
// claim, not the bytes. The limit only becomes real where the bytes are read,
// and only if that reader applies the same number.
export const MAX_TEMPORARY_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_PROBLEM_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
