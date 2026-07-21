import type { useFormatter, useTranslations } from "next-intl";

import type { LocationStatus } from "./api-client";

// Works with both the sync `useFormatter()` and async `getFormatter()`
// results; formatting honors the request locale and tenant timezone.
export type IntlFormatter = ReturnType<typeof useFormatter>;

// Translator scoped to the `common` namespace (from `useTranslations` or
// `getTranslations`).
export type CommonTranslator = ReturnType<typeof useTranslations<"common">>;

export function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

// Translates enum-like values (statuses, priorities, visit types) through
// `common.labels.*`, falling back to the humanized raw value for anything
// the dictionary does not know about.
export function formatEnumLabel(t: CommonTranslator, value: string): string {
  const key = `labels.${value}`;

  return t.has(key as never) ? t(key as never) : formatLabel(value);
}

export function formatEnumLabelOrDash(
  t: CommonTranslator,
  value: unknown,
): string {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
  }

  return formatEnumLabel(t, value);
}

export function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue || null;
}

// Shared by every locations filter page (manager and field): a location's
// filter status is one of these three values or unset (any).
export function normalizeLocationStatus(
  value: string | undefined,
): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

export function formatDateTime(
  format: IntlFormatter,
  value: string | null,
  emptyLabel = "-",
): string {
  if (!value) {
    return emptyLabel;
  }

  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatShortDate(
  format: IntlFormatter,
  value: string | null,
  emptyLabel = "-",
): string {
  if (!value) {
    return emptyLabel;
  }

  return format.dateTime(new Date(value), {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
}

export function statusTone(
  status: "active" | "inactive" | "archived",
): "active" | "info" | "warning" {
  if (status === "active") {
    return "active";
  }

  return status === "archived" ? "warning" : "info";
}

// Pill tone for a visit or task status. Work in flight is the only state that
// carries the info tone: everything not started yet (open, draft) is neutral,
// so "in progress" is not the same colour as the state it moved on from.
export function statusPillTone(
  status: string,
): "active" | "info" | "neutral" | "warning" {
  if (status === "done" || status === "completed") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  if (status === "in_progress") {
    return "info";
  }

  return "neutral";
}
