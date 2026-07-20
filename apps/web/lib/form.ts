// FormData.get() returns string | File | null; coercing a File through
// String() would yield "[object File]", so non-string values map to "".
export function getFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Empty string (an untouched or cleared input) means "not set" — mirrors the
// backend's own undefined/null-means-absent convention for optional fields.
export function getFormOptionalString(
  formData: FormData,
  name: string,
): string | null {
  const value = getFormString(formData, name).trim();
  return value || null;
}

export function getFormOptionalNumber(
  formData: FormData,
  name: string,
): number | null {
  const value = getFormString(formData, name).trim();

  if (!value) {
    return null;
  }

  // Unparseable input maps to null explicitly, rather than relying on
  // JSON.stringify silently turning a NaN into null on the wire — the
  // `type="number"` inputs this feeds make it nearly unreachable in
  // practice (the browser sends "" for invalid input), and the backend
  // validates regardless, but the null here should be a deliberate "not
  // set", not an accident of serialization.
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Checkboxes only appear in FormData when checked; an absent field means
// unchecked, not "not set" — there is no tri-state here.
export function getFormBoolean(formData: FormData, name: string): boolean {
  return formData.get(name) !== null;
}
