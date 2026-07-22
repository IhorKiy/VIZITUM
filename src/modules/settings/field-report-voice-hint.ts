import { Prisma } from "@prisma/client";

import { FIELD_REPORT_VOICE_HINT_SETTING_KEY } from "./settings.types";

// Single home for the field_report_voice_hint TenantSetting semantics —
// the "absent row (or null value) means no hint" default and the write
// shape. Plain functions (not service methods) so callers can pass either
// the root Prisma client or a transaction client.

export const MAX_FIELD_REPORT_VOICE_HINT_LENGTH = 2000;

export function fieldReportVoiceHintFromSetting(
  setting: { value: Prisma.JsonValue } | null | undefined,
): string | null {
  if (!setting || typeof setting.value !== "string") {
    return null;
  }

  const trimmed = setting.value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

// `updatedByUserId` is a tenant-User FK: pass the acting tenant user's id, or
// null when the actor is not a tenant user (the platform owner).
export async function upsertFieldReportVoiceHintSetting(
  client: Prisma.TransactionClient,
  tenantId: string,
  voiceHint: string | null,
  updatedByUserId: string | null,
): Promise<void> {
  const value = voiceHint === null ? Prisma.JsonNull : voiceHint;

  await client.tenantSetting.upsert({
    where: {
      tenantId_key: { tenantId, key: FIELD_REPORT_VOICE_HINT_SETTING_KEY },
    },
    create: {
      tenantId,
      key: FIELD_REPORT_VOICE_HINT_SETTING_KEY,
      value,
      updatedByUserId,
    },
    update: { value, updatedByUserId },
  });
}
