"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { withBackOrigin } from "../lib/back-navigation";
import type { ApiResult, Visit } from "../lib/api-client";
import {
  classifyReportSendResult,
  outcomeForThrownSend,
  type ReportSendOutcome,
} from "../lib/report-send-outcome";
import { createVisitAction } from "../lib/visit-start-actions";
import {
  deleteVisitStartOutboxEntry,
  enqueueVisitStart,
  findPendingVisitStartForLocation,
  markVisitStartOutboxResolved,
  type VisitStartOutboxEntry,
  type VisitStartOutboxScope,
} from "../lib/visit-start-outbox";
import { AbandonVisitStartControl } from "./abandon-visit-start-control";

// Returning both together, rather than assigning an outer `let` from inside
// the try block, is deliberate — not just style. classifyReportSendResult's
// "sent" branch and result.ok are two separate discriminated unions with no
// type-level link between them, and a closured reassignment defeats
// TypeScript's narrowing of the caller's read of `result.data` afterward.
async function attemptCreateVisit(
  input: Parameters<typeof createVisitAction>[0],
): Promise<{ outcome: ReportSendOutcome; result: ApiResult<Visit> | null }> {
  try {
    const result = await createVisitAction(input);

    return { outcome: classifyReportSendResult(result), result };
  } catch {
    // With no network the Server Action's own request throws before any of
    // api-client's handling runs — the ordinary offline path, not an
    // exceptional one (see report-outbox-flush.ts for the same reasoning on
    // the confirm side).
    return { outcome: outcomeForThrownSend(), result: null };
  }
}

type StartVisitControlProps = {
  // The server's own answer, exactly as computed today — this is the default
  // render, so a rep on a live connection sees nothing different from before.
  activeVisit: { id: string } | null;
  locationId: string;
  // Null for a repeat visit on an already-visited stop, or a location reached
  // outside route context — the create is sent unlinked either way.
  routeItemId: string | null;
  // Changes label/style only: "start another visit" on a secondary button
  // instead of the primary "start visit" CTA.
  repeat: boolean;
  tenantSlug: string;
  userId: string;
  selfOrigin: string;
  // Where a genuine rejection sends the rep back to — the exact href the old
  // server action redirected to, so an already-rare failure path looks
  // identical to before.
  errorHref: string;
};

/**
 * Replaces the plain `<form action={startVisitAction}>` this used to be.
 * Starting a visit now has to work with no signal at all, which a Server
 * Action redirect cannot do (see the field-menu.tsx sign-out handler for the
 * same constraint elsewhere in this zone) — so this mints the client id,
 * queues the create, and decides where to send the rep before the network
 * has necessarily answered at all.
 *
 * The `activeVisit` prop is the server's own truth and always wins when it
 * has an answer; the effect below only ever *adds* a "continue, still
 * syncing" state on top of "no active visit", the same discipline
 * useFieldReportDraft already established — a rep on a live connection never
 * sees this component render anything other than exactly what the server
 * decided.
 */
export function StartVisitControl({
  activeVisit,
  locationId,
  routeItemId,
  repeat,
  tenantSlug,
  userId,
  selfOrigin,
  errorHref,
}: StartVisitControlProps) {
  const t = useTranslations("field.location");
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  // undefined = the local check hasn't resolved yet, distinct from null
  // (checked, nothing pending) — the button below is disabled for exactly
  // the undefined state, so a double-tap in the brief window before this
  // resolves can't mint a second clientVisitId for the same unlinked start,
  // which is precisely what this check exists to prevent in the first place.
  const [pendingLocal, setPendingLocal] = useState<
    VisitStartOutboxEntry | null | undefined
  >(undefined);

  const scope = useMemo<VisitStartOutboxScope>(
    () => ({ tenantSlug, userId }),
    [tenantSlug, userId],
  );

  // The server's "is there an active visit" list only knows about visits it
  // has heard of, so without this a rep who backs out and re-taps "start"
  // while still offline would mint a second id for the same stop.
  useEffect(() => {
    if (activeVisit) {
      setPendingLocal(null);
      return;
    }

    let cancelled = false;

    void findPendingVisitStartForLocation(scope, locationId).then((entry) => {
      if (!cancelled) setPendingLocal(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [activeVisit, scope, locationId]);

  async function handleStart() {
    setIsStarting(true);

    const clientVisitId = crypto.randomUUID();
    // Captured once, here, and resent verbatim on every retry the background
    // flush makes — the backend's bounded window exists to record when the
    // rep actually walked in, not when a retry happened to land.
    const startedAt = new Date().toISOString();
    const queuedKey = await enqueueVisitStart(scope, {
      clientVisitId,
      locationId,
      routeItemId,
      visitType: "field_visit",
      startedAt,
    });

    const { outcome, result } = await attemptCreateVisit({
      locationId,
      representativeUserId: userId,
      visitType: "field_visit",
      routeItemId: routeItemId ?? undefined,
      startedAt,
      clientVisitId,
    });

    if (outcome.kind === "rejected") {
      // The server answered and refused, and the rep is standing right
      // here — nothing to remember, since this never became a mapping
      // anything depends on (see visit-start-outbox.ts).
      if (queuedKey) await deleteVisitStartOutboxEntry(queuedKey);
      router.push(errorHref);
      return;
    }

    if (!queuedKey && outcome.kind !== "sent") {
      // Nothing reached the server and the device would not keep it either.
      router.push(errorHref);
      return;
    }

    if (outcome.kind === "sent" && result?.ok) {
      // The rep is sent straight to the real id and never sees clientVisitId,
      // so there is nothing to rekey — but leaving the entry unresolved would
      // still leave it visible to findPendingVisitStartForLocation until the
      // next background flush happens to run. Within one SPA session that can
      // be a long wait: mark it resolved now, or a rep who starts online,
      // finishes the whole visit, and comes back to this same location card
      // without a hard reload sees "Continue visit — hasn't reached the
      // server yet" for a visit that has been done for a while.
      if (queuedKey)
        await markVisitStartOutboxResolved(queuedKey, result.data.id);

      router.push(
        withBackOrigin(
          `/${tenantSlug}/field/visits/${result.data.id}`,
          selfOrigin,
        ),
      );
      return;
    }

    // Queued: no signal, or a server-side failure a retry may outlive. The
    // client id is resolvable from here on regardless — see field-db.ts's
    // dual-id lookup on the backend — so the rep can start working now.
    router.push(
      withBackOrigin(
        `/${tenantSlug}/field/visits/${clientVisitId}`,
        selfOrigin,
      ),
    );
  }

  if (activeVisit) {
    return (
      <a
        className="primary-button location-start-visit"
        href={withBackOrigin(
          `/${tenantSlug}/field/visits/${activeVisit.id}`,
          selfOrigin,
        )}
      >
        <span aria-hidden="true">▶</span> {t("continueVisit")}
      </a>
    );
  }

  if (pendingLocal) {
    return (
      <>
        <a
          className="primary-button location-start-visit"
          href={withBackOrigin(
            `/${tenantSlug}/field/visits/${pendingLocal.clientVisitId}`,
            selfOrigin,
          )}
        >
          <span aria-hidden="true">▶</span> {t("continueVisit")}
        </a>
        <p className="form-hint">{t("continueVisitPendingHint")}</p>
        {/* The way back out of a start nobody wants after all. Without it this
            state is a one-way door: the rep can only navigate away, and the
            queued start syncs into a real visit nobody ever confirms or
            cancels. Dropping the local state is enough to restore the card —
            no router.refresh(), since the server's own render of this stop
            never knew about this visit and does not change. */}
        <AbandonVisitStartControl
          clientVisitId={pendingLocal.clientVisitId}
          onAbandoned={() => setPendingLocal(null)}
          scope={scope}
          tenantSlug={tenantSlug}
        />
      </>
    );
  }

  return (
    <>
      {repeat ? <p className="empty-state">{t("alreadyVisited")}</p> : null}
      <button
        className={
          repeat ? "secondary-button" : "primary-button location-start-visit"
        }
        disabled={isStarting || pendingLocal === undefined}
        onClick={() => void handleStart()}
        type="button"
      >
        <span aria-hidden="true">▶</span>{" "}
        {isStarting
          ? t("starting")
          : repeat
            ? t("startRepeatVisit")
            : t("startVisit")}
      </button>
    </>
  );
}
