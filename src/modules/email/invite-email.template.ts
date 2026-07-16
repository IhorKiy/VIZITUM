export type InviteEmailContent = {
  subject: string;
  text: string;
  html: string;
};

type InviteEmailTemplateParams = {
  tenantName: string;
  acceptUrl: string;
  expiresAt: Date;
  language: string;
  timezone: string;
};

type InviteEmailCopy = {
  subject: (tenantName: string) => string;
  intro: (tenantName: string) => string;
  action: string;
  button: string;
  validity: (expiresAtText: string) => string;
  ignore: string;
};

// Backend-rendered copy: the tenant's `language` setting decides the locale
// (same source of truth the web UI uses), so this intentionally does not go
// through apps/web message dictionaries. `uk` and `en` are the two supported
// tenant languages today; anything else falls back to English.
const COPY: Record<"en" | "uk", InviteEmailCopy> = {
  en: {
    subject: (tenantName) => `You are invited to ${tenantName} on Vizitum`,
    intro: (tenantName) =>
      `You have been invited to join ${tenantName} on Vizitum.`,
    action: "Open this link to accept the invite and set up your account:",
    button: "Accept invite",
    validity: (expiresAtText) => `The invite is valid until ${expiresAtText}.`,
    ignore:
      "If you did not expect this invitation, you can safely ignore this email.",
  },
  uk: {
    subject: (tenantName) => `Вас запрошено до ${tenantName} у Vizitum`,
    intro: (tenantName) =>
      `Вас запрошено приєднатися до ${tenantName} у Vizitum.`,
    action:
      "Відкрийте це посилання, щоб прийняти запрошення та налаштувати обліковий запис:",
    button: "Прийняти запрошення",
    validity: (expiresAtText) => `Запрошення дійсне до ${expiresAtText}.`,
    ignore:
      "Якщо ви не очікували цього запрошення, просто проігноруйте цей лист.",
  },
};

export function buildInviteEmail(
  params: InviteEmailTemplateParams,
): InviteEmailContent {
  const locale = params.language === "uk" ? "uk" : "en";
  const copy = COPY[locale];
  const expiresAtText = formatExpiry(params.expiresAt, locale, params.timezone);

  const text = [
    copy.intro(params.tenantName),
    "",
    copy.action,
    params.acceptUrl,
    "",
    copy.validity(expiresAtText),
    copy.ignore,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(copy.intro(params.tenantName))}</p>`,
    `<p>${escapeHtml(copy.action)}</p>`,
    `<p><a href="${escapeHtml(params.acceptUrl)}" style="display:inline-block;padding:10px 20px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(copy.button)}</a></p>`,
    `<p><a href="${escapeHtml(params.acceptUrl)}">${escapeHtml(params.acceptUrl)}</a></p>`,
    `<p>${escapeHtml(copy.validity(expiresAtText))}<br />${escapeHtml(copy.ignore)}</p>`,
  ].join("\n");

  return {
    subject: copy.subject(params.tenantName),
    text,
    html,
  };
}

function formatExpiry(
  expiresAt: Date,
  locale: "en" | "uk",
  timezone: string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: timezone,
    }).format(expiresAt);
  } catch {
    // An unparseable tenant timezone must not block the invite email.
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(expiresAt);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
