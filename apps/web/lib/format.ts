export function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function formatLabelOrDash(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
  }

  return formatLabel(value);
}

export function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue || null;
}

export function formatDateTime(value: string | null, emptyLabel = "-"): string {
  if (!value) {
    return emptyLabel;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatShortDate(
  value: string | null,
  emptyLabel = "-",
): string {
  if (!value) {
    return emptyLabel;
  }

  return new Intl.DateTimeFormat("en", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

export function statusTone(
  status: "active" | "inactive" | "archived",
): "active" | "info" | "warning" {
  if (status === "active") {
    return "active";
  }

  return status === "archived" ? "warning" : "info";
}

export function statusPillTone(status: string): "active" | "info" | "warning" {
  if (status === "done" || status === "completed") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}
