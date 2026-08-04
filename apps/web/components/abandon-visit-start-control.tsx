"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  abandonVisitStart,
  readAbandonVisitStartImpact,
} from "../lib/abandon-visit-start";
import type { VisitStartOutboxScope } from "../lib/visit-start-outbox";

type AbandonVisitStartControlProps = {
  clientVisitId: string;
  scope: VisitStartOutboxScope;
  tenantSlug: string;
  // Called once the local delete has landed. The two callers want different
  // things afterwards — the location card drops its "still syncing" state in
  // place, the report screen has to leave a URL that no longer resolves to
  // anything — and neither is this component's business to guess.
  onAbandoned: () => void;
};

/**
 * The way out of a visit that only exists on this device: started with no
 * signal, never synced, and now not wanted. Its counterpart for a real visit
 * is CancelVisitModal, and the difference between them is not cosmetic — see
 * lib/abandon-visit-start.ts for why this one sends nothing, asks for no
 * reason, and has to re-check the queue before it deletes anything.
 *
 * An inline confirm rather than that modal's <dialog>: there is no form to
 * fill, so the whole interaction is one sentence and two buttons, and the
 * markup is ConfirmActionButton's (same classes, same focus handling) rather
 * than a second confirm idiom in the same zone. It is not that component
 * because that one drives a Server Action through a FormData transition —
 * this runs against on-device storage, which is the one thing a Server Action
 * can never reach.
 */
export function AbandonVisitStartControl({
  clientVisitId,
  scope,
  tenantSlug,
  onAbandoned,
}: AbandonVisitStartControlProps) {
  const t = useTranslations("field.visit");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  // What the prompt will name as discarded — null until the read lands, so it
  // never states a wrong answer and then corrects itself. Purely
  // informational: the delete does not consult it.
  const [impact, setImpact] = useState<{
    report: boolean;
    media: boolean;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // On opening the prompt, not on mount: what this has to report on — a photo
  // taken, a report confirmed while still offline — only comes into existence
  // after this control has been sitting on the screen for a while. Same
  // reasoning as CancelVisitModal's check, and the same freshness guarantee,
  // which here falls out of the effect's own cleanup rather than a generation
  // counter.
  useEffect(() => {
    if (!confirming) {
      return;
    }

    let cancelled = false;

    void readAbandonVisitStartImpact(scope, clientVisitId).then((result) => {
      if (!cancelled) setImpact(result);
    });

    return () => {
      cancelled = true;
    };
  }, [confirming, scope, clientVisitId]);

  // Confirming unmounts the trigger and cancelling unmounts the prompt, so
  // focus has to be moved by hand or it drops to the document body —
  // ConfirmActionButton's problem exactly, solved the same way.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (wasConfirming.current) {
      triggerRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  async function run() {
    setWorking(true);

    let decision: Awaited<ReturnType<typeof abandonVisitStart>>;
    try {
      decision = await abandonVisitStart(scope, clientVisitId);
    } catch {
      // The storage layer is built to degrade rather than throw, so this is
      // for the WebView that breaks that promise: without it the buttons stay
      // disabled on "Cancelling..." forever. Re-arm them and keep the prompt
      // open, so the tap can simply be repeated.
      setWorking(false);
      return;
    }

    if (decision.kind === "synced") {
      // It reached the server while the rep was reading the prompt. Nothing
      // was deleted; the real visit is where cancelling it belongs now.
      router.replace(`/${tenantSlug}/field/visits/${decision.visitId}`);
      return;
    }

    setWorking(false);
    setConfirming(false);
    // Clears what the prompt would have reported, so a later re-open never
    // flashes stale data before the fresh read above lands. Co-located with
    // the two places `confirming` itself becomes false rather than watched
    // for via a render-time comparison — unlike a prop, this component owns
    // `confirming` outright, so every transition to false already happens in
    // code we control.
    setImpact(null);
    onAbandoned();
  }

  if (!confirming) {
    return (
      <button
        className="secondary-button danger"
        onClick={() => setConfirming(true)}
        ref={triggerRef}
        type="button"
      >
        {t("abandonPendingVisit")}
      </button>
    );
  }

  return (
    <div className="confirm-action confirming">
      {/* role="alert": focus lands on the confirm button when the prompt
          opens, so without an announcement a screen reader hears only the
          button's label and never the sentence explaining what a tap will
          discard — which arrives in two parts, the impact clause async. */}
      <span className="confirm-action-prompt" role="alert">
        {t("abandonPendingPrompt")}
        {impact?.report
          ? ` ${t("abandonPendingUnsentReport")}`
          : impact?.media
            ? ` ${t("abandonPendingUnsentMedia")}`
            : ""}
      </span>
      <div className="confirm-action-buttons">
        <button
          className="secondary-button danger"
          disabled={working}
          onClick={() => void run()}
          ref={confirmRef}
          type="button"
        >
          {working ? t("abandonPendingPending") : t("abandonPendingConfirm")}
        </button>
        <button
          className="secondary-button"
          disabled={working}
          onClick={() => {
            setConfirming(false);
            // See the matching comment in run() above.
            setImpact(null);
          }}
          type="button"
        >
          {tCommon("cancel")}
        </button>
      </div>
    </div>
  );
}
