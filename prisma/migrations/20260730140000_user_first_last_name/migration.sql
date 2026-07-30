-- Users were created with a single free-text `name`, which the product could
-- never take apart reliably: the field home screen greeted people with
-- `name.split(" ")[0]`, and anything else that wanted a given name had no way
-- to ask for one. `firstName`/`lastName` become the source of truth; `name`
-- stays as a derived display value composed by `composeUserDisplayName`, so the
-- ~30 read sites that only ever render a full name keep working untouched.
--
-- Both columns are added nullable so the backfill can run against existing
-- rows, and only `firstName` is promoted to NOT NULL afterwards. `lastName`
-- stays nullable on purpose: a legacy one-word name ("Owner") leaves nothing to
-- put there, and NULL says "we never knew" rather than inventing an empty
-- surname. Every new write supplies both — that is enforced in the service
-- layer, not here, exactly like the phone-country rule for legacy tenants.
ALTER TABLE "users" ADD COLUMN "firstName" TEXT;
ALTER TABLE "users" ADD COLUMN "lastName" TEXT;

-- The split is on the FIRST space, not the last: the product writes names in
-- "Ім'я Прізвище" / "First Last" order, so the leading token is the given name
-- and everything after it belongs to the surname ("Demo Field Representative"
-- becomes "Demo" + "Field Representative"). Interior runs of whitespace are
-- collapsed first so a double space can't produce an empty surname.
UPDATE "users"
SET "firstName" = CASE
      WHEN position(' ' in btrim(regexp_replace("name", '\s+', ' ', 'g'))) = 0
        THEN btrim(regexp_replace("name", '\s+', ' ', 'g'))
      ELSE split_part(btrim(regexp_replace("name", '\s+', ' ', 'g')), ' ', 1)
    END,
    "lastName" = CASE
      WHEN position(' ' in btrim(regexp_replace("name", '\s+', ' ', 'g'))) = 0
        THEN NULL
      ELSE substring(
        btrim(regexp_replace("name", '\s+', ' ', 'g'))
        from position(' ' in btrim(regexp_replace("name", '\s+', ' ', 'g'))) + 1
      )
    END;

ALTER TABLE "users" ALTER COLUMN "firstName" SET NOT NULL;
