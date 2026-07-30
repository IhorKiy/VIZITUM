// The one rule that decides whether a capture waiting on the device keeps the
// storage object it already consumed or has to register a new one. Split out of
// the report form because it is the part that goes wrong silently: get it wrong
// in one direction and a recording becomes permanently unsendable, get it wrong
// in the other and every flaky retry leaves a second storage object — and, for
// audio, a second `VisitNote` — behind on the visit.

// The failure half of `ApiResult`, narrowed to what the decision reads.
export type ApiFailure = {
  status: number;
  code?: string;
};

// True only when the server ruled on this object id: it is malformed, it does
// not exist in the tenant, or it is no longer active because the cleanup worker
// swept it (`STORAGE_OBJECT_INVALID` / `_NOT_FOUND` / `_NOT_ACTIVE` in
// src/modules/storage/storage.service.ts — every code that namespace can
// produce is such a ruling, so the prefix is matched rather than the three
// values). A bare 404 counts too, for a proxy that returns the status without
// the body.
//
// Everything else — no network at all, a 5xx, a session that expired while the
// bytes waited, a permission answer about the caller rather than the object — is
// not an answer about the object, and the registration it is holding is still
// good. That distinction is the whole point: in a dead zone, "no answer" is the
// ordinary outcome, and it must not be read as "the object is gone".
export function isStorageObjectGone(failure: ApiFailure): boolean {
  return (
    failure.status === 404 ||
    Boolean(failure.code?.startsWith("STORAGE_OBJECT_"))
  );
}
