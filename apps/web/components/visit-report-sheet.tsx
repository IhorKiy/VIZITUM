import { useTranslations } from "next-intl";

import { ConfirmedFieldReportSummary } from "./confirmed-field-report-summary";
import { Sheet } from "./sheet";
import type { Visit } from "../lib/api-client";
import { formatCancellationReason } from "../lib/visit-cancellation";

type VisitReportSheetProps = {
  // Where the list lives with the sheet closed — this URL minus `open`.
  closeHref: string;
  // The confirmed report, or null when there is none to show (see the two
  // states below, which are the reasons a finished visit may carry no report).
  report: { confirmedAt: string; confirmedData: unknown } | null;
  // Why the report could not be read, when that is a real failure. A cancelled
  // visit with no report is not one — see `isCancelledWithoutReport`.
  reportErrorMessage: string | null;
  isCancelledWithoutReport: boolean;
  problemPhotoUrl: string | null;
  visit: Visit;
};

/**
 * A finished visit's report, in a sheet over the history list.
 *
 * Reading a past visit is a look, not a journey: the rep is scanning down a
 * list, wants to check what was written at one outlet, and wants to be back in
 * the same place in the same list afterwards — which a full page navigation
 * cannot give them, since returning re-renders the list at the top and costs a
 * round trip on a phone that may have no signal at all.
 *
 * Only *finished* visits open this way. An unconfirmed report is where the work
 * happens — recording, transcription, the manual fallback — and that needs the
 * whole screen, so those rows still navigate (see the history list's row href).
 *
 * Same URL-as-state contract as the task sheet, through the same shell: the row
 * links to `?open=<visitId>`, this renders because the server saw it, and the
 * phone's back gesture closes it.
 */
export function VisitReportSheet({
  closeHref,
  isCancelledWithoutReport,
  problemPhotoUrl,
  report,
  reportErrorMessage,
  visit,
}: VisitReportSheetProps) {
  const t = useTranslations("field.visit");
  const tCommon = useTranslations("common");
  const locationAddress = [visit.location.addressLine, visit.location.city]
    .filter(Boolean)
    .join(", ");

  return (
    <Sheet
      ariaLabel={visit.location.name}
      closeHref={closeHref}
      closeLabel={tCommon("close")}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 className="sheet-title">{visit.location.name}</h2>
          {locationAddress ? (
            <p className="visit-sheet-address">{locationAddress}</p>
          ) : null}
        </div>

        {report ? (
          <div className="visit-sheet-report">
            <ConfirmedFieldReportSummary
              confirmedAt={report.confirmedAt}
              confirmedData={report.confirmedData}
              problemPhotoUrl={problemPhotoUrl}
            />
          </div>
        ) : isCancelledWithoutReport ? (
          /* A cancelled visit legitimately never gets a confirmed report —
             that's not a load failure, so it gets a neutral notice instead of
             the danger one a completed visit missing its report still shows. */
          <section
            aria-label={t("cancelledNoReportAria")}
            className="visit-sheet-notice"
          >
            <p className="eyebrow">{t("cancelledNoReportEyebrow")}</p>
            <h3>{t("cancelledNoReportTitle")}</h3>
            <p>{t("cancelledNoReportBody")}</p>
            {visit.cancellationReason ? (
              <p>
                {t("cancelledReasonLabel")}
                {": "}
                {formatCancellationReason(tCommon, visit.cancellationReason)}
                {visit.cancellationComment
                  ? ` — ${visit.cancellationComment}`
                  : null}
              </p>
            ) : null}
          </section>
        ) : (
          <section
            aria-label={t("reportErrorAria")}
            className="visit-sheet-notice is-danger"
          >
            <p className="eyebrow">{t("reportErrorEyebrow")}</p>
            <h3>{t("reportErrorTitle")}</h3>
            <p>{reportErrorMessage}</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
