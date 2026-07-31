export type PasswordResetEmailContent = {
  subject: string;
  text: string;
  html: string;
};

type PasswordResetEmailTemplateParams = {
  tenantName: string;
  resetUrl: string;
  expiresAt: Date;
  language: string;
  timezone: string;
};

type PasswordResetEmailCopy = {
  subject: (tenantName: string) => string;
  intro: (tenantName: string) => string;
  action: string;
  button: string;
  validity: (expiresAtText: string) => string;
  ignore: string;
};

// Same locale rule as the invite template: the tenant's `language` setting
// decides the copy, so this does not go through apps/web message dictionaries.
//
// The "you can ignore this" line carries more weight here than it does on an
// invite. A reset mail is the one message in the product that lands in the
// inbox of someone who did nothing — either they mistyped their own address
// somewhere, or a stranger typed it into the forgot form — and it has to say,
// without hedging, that ignoring it leaves the account untouched.
const COPY: Record<"en" | "uk", PasswordResetEmailCopy> = {
  en: {
    subject: (tenantName) => `Reset your ${tenantName} password on Vizitum`,
    intro: (tenantName) =>
      `Someone asked to reset the password for your ${tenantName} account on Vizitum.`,
    action: "Open this link to choose a new password:",
    button: "Choose a new password",
    validity: (expiresAtText) => `The link is valid until ${expiresAtText}.`,
    ignore:
      "If you did not ask for this, you can safely ignore this email — your password stays unchanged.",
  },
  uk: {
    subject: (tenantName) => `Відновлення паролю ${tenantName} у Vizitum`,
    intro: (tenantName) =>
      `Хтось попросив відновити пароль до вашого облікового запису ${tenantName} у Vizitum.`,
    action: "Відкрийте це посилання, щоб задати новий пароль:",
    button: "Задати новий пароль",
    validity: (expiresAtText) => `Посилання дійсне до ${expiresAtText}.`,
    ignore:
      "Якщо ви цього не робили, просто проігноруйте цей лист — ваш пароль залишиться незмінним.",
  },
};

export function buildPasswordResetEmail(
  params: PasswordResetEmailTemplateParams,
): PasswordResetEmailContent {
  const locale = params.language === "uk" ? "uk" : "en";
  const copy = COPY[locale];
  const expiresAtText = formatExpiry(params.expiresAt, locale, params.timezone);

  const text = [
    copy.intro(params.tenantName),
    "",
    copy.action,
    params.resetUrl,
    "",
    copy.validity(expiresAtText),
    copy.ignore,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(copy.intro(params.tenantName))}</p>`,
    `<p>${escapeHtml(copy.action)}</p>`,
    `<p><a href="${escapeHtml(params.resetUrl)}" style="display:inline-block;padding:10px 20px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(copy.button)}</a></p>`,
    `<p><a href="${escapeHtml(params.resetUrl)}">${escapeHtml(params.resetUrl)}</a></p>`,
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
    // An unparseable tenant timezone must not block the reset email.
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
