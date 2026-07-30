"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EMPTY_OUTBOX_STATE,
  flushReportOutbox,
  readReportOutboxState,
  type ReportOutboxState,
} from "../lib/report-outbox-flush";
import type { ReportOutboxScope } from "../lib/report-outbox";
import { LoaderIcon, SaveIcon } from "./icons";

type ReportOutboxIndicatorProps = {
  tenantSlug: string;
  userId: string;
};

/**
 * Sits in the field layout, so it survives navigation between field screens and
 * keeps one sender for the whole zone rather than one per page.
 *
 * There is no Background Sync here on purpose: iOS Safari does not implement it,
 * and a rep's phone is the case this exists for. So sending happens at the
 * moments the app is actually running — it opens, it comes back to the
 * foreground, or the browser says the network returned — plus a button, because
 * a rep who can see an unsent count should be able to act on it rather than
 * wait and hope.
 */
export function ReportOutboxIndicator({
  tenantSlug,
  userId,
}: ReportOutboxIndicatorProps) {
  const t = useTranslations("field.outbox");
  const router = useRouter();
  const [state, setState] = useState<ReportOutboxState>(EMPTY_OUTBOX_STATE);
  const [isSending, setIsSending] = useState(false);

  const scope = useMemo<ReportOutboxScope>(
    () => ({ tenantSlug, userId }),
    [tenantSlug, userId],
  );

  const send = useCallback(
    async (options: { includeRejected?: boolean } = {}) => {
      setIsSending(true);

      try {
        const before = await readReportOutboxState(scope);

        if (before.pending === 0 && !options.includeRejected) {
          setState(before);
          return;
        }

        const after = await flushReportOutbox(scope, options);

        setState(after);

        // Something left the queue, so the screens behind this — today's route,
        // the history, the visit itself — are now describing a world one step
        // out of date.
        if (after.pending < before.pending) {
          router.refresh();
        }
      } finally {
        setIsSending(false);
      }
    },
    [router, scope],
  );

  useEffect(() => {
    let cancelled = false;

    // Show whatever is queued before trying to send it: a rep opening the app in
    // a dead zone should still see that their reports are waiting.
    void readReportOutboxState(scope).then((initial) => {
      if (!cancelled) setState(initial);
    });
    void send();

    const onOnline = () => void send();
    const onVisible = () => {
      if (document.visibilityState === "visible") void send();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scope, send]);

  const total = state.pending + state.needsAttention;

  if (total === 0) return null;

  return (
    <section aria-label={t("ariaLabel")} className="report-outbox">
      <p className="report-outbox-text">
        {state.signInRequired
          ? t("signInRequired", { count: state.pending })
          : state.needsAttention > 0
            ? t("needsAttention", { count: state.needsAttention })
            : t("pending", { count: state.pending })}
      </p>
      {state.signInRequired ? (
        <a className="secondary-button" href={`/${tenantSlug}/login`}>
          {t("signIn")}
        </a>
      ) : (
        <button
          className="secondary-button"
          disabled={isSending}
          onClick={() => void send({ includeRejected: true })}
          type="button"
        >
          {isSending ? <LoaderIcon /> : <SaveIcon />}
          {isSending ? t("sending") : t("sendNow")}
        </button>
      )}
    </section>
  );
}
