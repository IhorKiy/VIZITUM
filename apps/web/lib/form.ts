// FormData.get() returns string | File | null; coercing a File through
// String() would yield "[object File]", so non-string values map to "".
export function getFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
