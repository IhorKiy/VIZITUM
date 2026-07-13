"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DismissableNoticeProps = {
  tone: "success" | "danger";
  ariaLabel: string;
  eyebrow: string;
  title: string;
  body: string;
  // Query params to strip from the URL once dismissed, so a refresh (or back
  // navigation) does not resurface the notice.
  clearParams: string[];
  timeoutMs?: number;
};

export function DismissableNotice({
  tone,
  ariaLabel,
  eyebrow,
  title,
  body,
  clearParams,
  timeoutMs = 5000,
}: DismissableNoticeProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), timeoutMs);
    const remove = setTimeout(() => {
      setHidden(true);
      const url = new URL(window.location.href);
      for (const param of clearParams) {
        url.searchParams.delete(param);
      }
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }, timeoutMs + 300);

    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
    // Run once on mount; the notice content is fixed for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden) {
    return null;
  }

  return (
    <section
      aria-label={ariaLabel}
      className={`notice-panel ${tone} auto-dismiss${
        leaving ? " is-leaving" : ""
      }`}
    >
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </section>
  );
}
