"use client";

import { useEffect, useState, type ReactNode } from "react";

type AutoDismissNoticeProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  clearParams: string[];
  delayMs?: number;
};

export function AutoDismissNotice({
  ariaLabel,
  children,
  className,
  clearParams,
  delayMs = 4000,
}: AutoDismissNoticeProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVisible(false);

      const url = new URL(window.location.href);
      for (const param of clearParams) {
        url.searchParams.delete(param);
      }

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [clearParams, delayMs]);

  if (!visible) {
    return null;
  }

  return (
    <section aria-label={ariaLabel} className={className}>
      {children}
    </section>
  );
}
