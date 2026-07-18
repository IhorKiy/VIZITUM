-- Before archival became a soft delete, the edit form could write
-- status = 'archived' directly. Such rows (status 'archived', deletedAt NULL)
-- are stranded under the new model: they show up in the live list, the
-- `status=archived` filter (now `deletedAt IS NOT NULL`) can never surface
-- them, and the edit form's status select no longer offers 'archived', so a
-- save would silently flip them to 'active'. Convert them to the deletedAt
-- model: mark them archived and normalize the enum value to 'inactive' so a
-- later restore brings back a valid live row.
UPDATE "locations"
SET "deletedAt" = COALESCE("deletedAt", now()),
    "status" = 'inactive'
WHERE "status" = 'archived';
