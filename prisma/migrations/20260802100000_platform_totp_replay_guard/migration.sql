-- The TOTP step of the last code accepted for this account. A code is valid
-- across three steps (the current one and one either side, for clock drift),
-- so without this the same six digits can be spent more than once inside
-- roughly ninety seconds. Nullable: an account that has never signed in with
-- a code has no last step, and the first accepted code sets it.
ALTER TABLE "platform_users" ADD COLUMN     "totpLastUsedStep" INTEGER;
