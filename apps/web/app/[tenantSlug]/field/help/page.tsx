import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { BackLink } from "../../../../components/back-link";
import { resolveBackTarget } from "../../../../lib/back-navigation";

type HelpPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ from?: string }>;
};

// Reference-only: no session fetch and no API calls, so the answers stay
// readable when the backend is the very thing that failed and sent the
// representative looking for help.
export default async function FieldHelpPage({
  params,
  searchParams,
}: HelpPageProps) {
  const { tenantSlug } = await params;
  const { from } = await searchParams;
  const [t, tBack] = await Promise.all([
    getTranslations("field.help"),
    getTranslations("common.back"),
  ]);

  // The menu opens this from any field screen, so the opener states itself and
  // is resolved here; a deep link falls back to the home route.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
  const questions = ["faq1", "faq2", "faq3", "faq4", "faq5"] as const;

  return (
    <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
      <header className="page-header page-header--compact">
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <h1>{t("title")}</h1>
      </header>

      <section aria-label={t("title")} className="panel">
        <div className="faq-list">
          {questions.map((question) => (
            <details className="faq-item" key={question}>
              <summary className="faq-question">
                {t(`${question}Question`)}
              </summary>
              <p className="faq-answer">{t(`${question}Answer`)}</p>
            </details>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
