"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type DismissableNoticeProps = {
  tone: "success" | "danger";
  ariaLabel: string;
  eyebrow: string;
  title: string;
  body?: string;
  // Extra content rendered under the body — e.g. an invite link the user has to
  // copy. A notice carrying content like this must set autoDismiss={false}.
  children?: ReactNode;
  // Buttons/links rendered beside the text. Only put shortcuts here that stay
  // reachable elsewhere, since an auto-dismissing notice takes them with it.
  actions?: ReactNode;
  // Query params to strip from the URL once dismissed, so a refresh (or back
  // navigation) does not resurface the notice.
  clearParams: string[];
  // Defaults to true for success and false for danger: error notices stay put
  // until the user navigates or acts, because auto-dismissing would hide
  // failure detail (e.g. a server-provided message) before it can be read.
  // Pass false explicitly for a success notice whose content the user still
  // needs (an invite link), which would be destroyed by hiding it.
  autoDismiss?: boolean;
  timeoutMs?: number;
};

export function DismissableNotice({
  tone,
  ariaLabel,
  eyebrow,
  title,
  body,
  children,
  actions,
  clearParams,
  autoDismiss,
  timeoutMs = 5000,
}: DismissableNoticeProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const dismisses = autoDismiss ?? tone === "success";

  useEffect(() => {
    if (!dismisses) {
      return;
    }

    const fade = setTimeout(() => setLeaving(true), timeoutMs);
    const remove = setTimeout(() => {
      setHidden(true);
      const url = new URL(window.location.href);
      for (const param of clearParams) {
        url.searchParams.delete(param);
      }
      router.replace(`${url.pathname}${url.search}${url.hash}`, {
        scroll: false,
      });
    }, timeoutMs + 300);

    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
    // Run once on mount; the notice content is fixed for this render.
    // (If eslint-plugin-react-hooks is added, restore its exhaustive-deps
    // disable directive here — the empty deps array is intentional.)
  }, []);

  if (hidden) {
    return null;
  }

  return (
    <section
      aria-label={ariaLabel}
      className={`notice-panel ${tone}${dismisses ? " auto-dismiss" : ""}${
        leaving ? " is-leaving" : ""
      }`}
    >
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
        {children}
      </div>
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </section>
  );
}
