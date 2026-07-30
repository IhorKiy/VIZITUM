-- Before #148, the two AiJob-driven writers of temporary_audio/temporary_transcript
-- objects (the failed-job sweep and cleanupTemporaryAiDataAfterConfirmation, both
-- in ai.service.ts) stamped `deletedAt` in the same update that marked a row
-- `expired` — recording a deletion that never happened, since only the cleanup
-- sweep actually calls R2's DeleteObject, and only after it succeeds. The sweep's
-- own `deletedAt: null` guard then excluded exactly those rows forever, so their
-- R2 bytes were never collected.
--
-- #148 stopped both writers from setting `deletedAt`, but every row they already
-- stamped before that fix is still tombstoned and permanently unsweepable: the
-- sweep will never look at a row with `deletedAt` set, no matter what its `status`
-- is. This clears those false tombstones back to `expired` (done processing, not
-- deleted) so the sweep picks them up and actually removes the bytes from R2.
--
-- Scoped to exactly the rows the two old writers could have produced: their
-- purposes only (temporary_audio, temporary_transcript — never visit_attachment
-- or any other purpose), and never a row already `deleted`, which is the sweep's
-- own mark that it already ran and R2 already confirmed the bytes gone. Excluding
-- `deleted` rows is what keeps this migration from resurrecting a tombstone the
-- sweep earned honestly.
UPDATE "storage_objects"
SET "deletedAt" = NULL,
    "status" = 'expired'
WHERE "deletedAt" IS NOT NULL
  AND "status" <> 'deleted'
  AND "purpose" IN ('temporary_audio', 'temporary_transcript');
