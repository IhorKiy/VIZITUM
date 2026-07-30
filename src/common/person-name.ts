// Canonical handling of a tenant user's name. `User.firstName`/`User.lastName`
// are the stored truth; `User.name` is a derived display string that must never
// be written on its own — every write path composes it here, so the three
// columns cannot drift apart.
//
// `lastName` is optional throughout: rows predating the split (backfilled from a
// one-word name) have none, and refusing to render them would break screens for
// data we simply never collected. New writes are required to supply both, but
// that rule belongs to the request validators, not to this module.

export type PersonNameParts = {
  firstName: string;
  lastName: string | null;
};

export type PersonNameFields = PersonNameParts & {
  name: string;
};

// Collapses interior whitespace so " Олена   Ковальчук " and "Олена Ковальчук"
// produce the same stored value, and a name typed with a stray double space
// can't split into an empty surname later.
export function normalizeNamePart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  return normalized || null;
}

export function composeUserDisplayName(
  firstName: string,
  lastName: string | null | undefined,
): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

// The single shape every write path hands to Prisma, so adding a name field
// later means changing one function rather than hunting down callers.
export function buildUserNameFields(parts: PersonNameParts): PersonNameFields {
  return {
    firstName: parts.firstName,
    lastName: parts.lastName,
    name: composeUserDisplayName(parts.firstName, parts.lastName),
  };
}
