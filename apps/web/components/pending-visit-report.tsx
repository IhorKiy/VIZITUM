"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { Product } from "../lib/api-client";
import { resolveBackTarget } from "../lib/back-navigation";
import {
  getFieldReportVoiceHintAction,
  listAllProductsAction,
} from "../lib/field-report-actions";
import {
  getVisitStartOutboxEntry,
  type VisitStartOutboxScope,
} from "../lib/visit-start-outbox";
import { flushVisitStartOutbox } from "../lib/visit-start-outbox-flush";
import { BackLink } from "./back-link";
import { FieldVisitReportForm } from "./field-visit-report-form";

type PendingVisitReportProps = {
  tenantSlug: string;
  userId: string;
  // The value from the URL — the visit's real id if the server has one, or
  // still the client-minted id if this visit was started offline and has not
  // synced yet. This component only ever mounts when the server just
  // answered "no such visit", so from here it's always the latter or a
  // genuinely bad link.
  visitId: string;
  from: string | undefined;
  // visitResult.message from the failed GET /visits/:id — carried down
  // rather than re-derived, so the "nothing local either" render is
  // byte-for-byte what this screen already showed before this component
  // existed.
  notFoundMessage: string;
};

type LoadState =
  | { status: "checking" }
  | { status: "not-found" }
  | {
      status: "pending";
      locationId: string;
      products: Product[];
      voiceHint: string | null;
    };

/**
 * What field/visits/[visitId]/page.tsx renders instead of a flat "not found"
 * when the server does not know this visit — which, now that a visit can be
 * started with no signal at all, no longer only means a bad link. Checks the
 * on-device start queue for this exact id: a visit that never synced yet
 * still has a working report screen here; a visit that finished syncing
 * under a different id (the adopt case — see visit-start-outbox.ts) redirects
 * there; anything else falls through to the same not-found panel this screen
 * always showed.
 *
 * Default render is `null` rather than a guess — unlike start-visit-control.tsx,
 * there is no safe default to show before this local read resolves, since the
 * two outcomes ("this is a legitimate offline-started visit" vs "this link is
 * just wrong") render completely different screens and guessing either one
 * would flash the wrong content for every visit of the *other* kind.
 */
export function PendingVisitReport({
  tenantSlug,
  userId,
  visitId,
  from,
  notFoundMessage,
}: PendingVisitReportProps) {
  const router = useRouter();
  const t = useTranslations("field.visit");
  const tField = useTranslations("field");
  const tLocation = useTranslations("field.location");
  const tBack = useTranslations("common.back");
  const tCommon = useTranslations("common");

  const [state, setState] = useState<LoadState>({ status: "checking" });

  const scope = useMemo<VisitStartOutboxScope>(
    () => ({ tenantSlug, userId }),
    [tenantSlug, userId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const entry = await getVisitStartOutboxEntry(scope, visitId);

      if (cancelled) return;

      if (!entry) {
        setState({ status: "not-found" });
        return;
      }

      if (entry.resolvedVisitId) {
        router.replace(`/${tenantSlug}/field/visits/${entry.resolvedVisitId}`);
        return;
      }

      // Tenant-scoped, not visit-scoped — these do not need the visit to
      // exist server-side, so this is real data when reachable, not a
      // placeholder. Only the shelf-check matrix genuinely needs a resolved
      // location and stays empty below.
      //
      // Each gets its own .catch(): a thrown Server Action invocation (no
      // network at all, same shape as every other queued send in this
      // system) must degrade the one input, not the whole screen — an
      // unhandled rejection here would leave the rep looking at nothing,
      // stuck on this effect's "checking" render forever.
      const [productsResult, voiceHintResult] = await Promise.all([
        listAllProductsAction().catch(() => null),
        getFieldReportVoiceHintAction().catch(() => null),
      ]);

      if (cancelled) return;

      setState({
        status: "pending",
        locationId: entry.locationId,
        products: productsResult?.ok ? productsResult.data : [],
        voiceHint: voiceHintResult?.ok ? voiceHintResult.data.voiceHint : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [scope, visitId, tenantSlug, router]);

  // Catches this visit resolving while the rep is already sitting on this
  // screen. report-outbox-indicator.tsx's router.refresh() (fired from the
  // layout, once the start queue shrinks) already self-heals the 3 backend
  // outcomes where this exact id keeps resolving — a refresh just re-runs
  // getVisit and finds it now. Only the adopt case needs this page to notice
  // on its own, since no refresh of *this* id will ever find anything.
  //
  // Attempts a real flush, not just a local re-read — the indicator's own
  // triggers (app-open, online, visibilitychange) live in the layout, which
  // does not remount on a client-side navigation to this screen, so none of
  // them are guaranteed to fire again while the rep stays right here. This is
  // the one place a rep is actively waiting on this exact resolution, so it
  // takes responsibility for nudging its own sync on an interval too, rather
  // than only reacting to someone else's trigger — confirmed necessary by
  // hand: seeding a resolvable entry and never touching online/visibility
  // left this screen showing "still syncing" indefinitely without it.
  useEffect(() => {
    if (state.status !== "pending") return;

    let cancelled = false;

    const check = () => {
      // navigator.onLine === false is the one definitive answer it gives —
      // skip the flush's real POST replay then (a rep parked on this screen
      // in a dead spot would otherwise fire one every 15s straight into a
      // failed fetch) but still do the local read, since another flusher
      // (the layout indicator, another tab) may have resolved the entry in
      // the meantime. true is *not* definitive, so it still attempts.
      const maybeFlush =
        navigator.onLine === false
          ? Promise.resolve()
          : flushVisitStartOutbox(scope).then(() => undefined);

      void maybeFlush
        .then(() => getVisitStartOutboxEntry(scope, visitId))
        .then((entry) => {
          if (!cancelled && entry?.resolvedVisitId) {
            router.replace(
              `/${tenantSlug}/field/visits/${entry.resolvedVisitId}`,
            );
          }
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const interval = window.setInterval(check, 15000);

    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.status, scope, visitId, tenantSlug, router]);

  if (state.status === "checking") return null;

  if (state.status === "not-found") {
    const notFoundBackTarget = resolveBackTarget(tenantSlug, from, {
      href: `/${tenantSlug}/field`,
      labelKey: "home",
    });

    return (
      <>
        <BackLink
          href={notFoundBackTarget.href}
          label={tBack(notFoundBackTarget.labelKey)}
        />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("notFoundTitle")}</h1>
          </div>
        </header>
        <section
          className="notice-panel danger"
          aria-label={t("visitErrorAria")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("loadErrorTitle")}</h2>
            <p>{notFoundMessage}</p>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="visit-report-header">
        <BackLink
          href={`/${tenantSlug}/field/locations/${state.locationId}`}
          inline
          label={tBack("location")}
        />
        <div>
          <h1>{t("pendingSyncTitle")}</h1>
          <p>{tLocation("continueVisitPendingHint")}</p>
        </div>
      </header>
      <FieldVisitReportForm
        products={state.products}
        shelfProducts={[]}
        tenantSlug={tenantSlug}
        userId={userId}
        visitId={visitId}
        voiceHint={state.voiceHint}
      />
    </>
  );
}
