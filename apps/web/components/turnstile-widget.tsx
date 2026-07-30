"use client";

import { useEffect, useRef } from "react";

// Explicit rendering (?render=explicit) instead of the implicit
// class="cf-turnstile" scan: the scan runs once at script load, so a widget
// mounted after a soft navigation (e.g. returning to the login page with
// ?error=...) would silently never appear.
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: { sitekey: string; language?: string },
  ) => string | undefined;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type TurnstileWidgetProps = {
  siteKey: string;
  // Tenant locale; without it Turnstile guesses from the browser, which may
  // disagree with the rest of the login screen.
  language?: string;
};

// Cloudflare Turnstile captcha for the login forms. Rendered inside the form
// element: Turnstile injects a hidden `cf-turnstile-response` input next to
// the widget, which the server action forwards to the API as `captchaToken`.
export function TurnstileWidget({ siteKey, language }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let pollId: number | undefined;

    function renderWidget() {
      const container = containerRef.current;

      if (!container || !window.turnstile) {
        return;
      }

      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        language,
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }

      // The api.js script exposes an onload callback, but a single global
      // callback name cannot serve two mounts racing for it; polling is
      // immune to that and stops on the first success.
      pollId = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(pollId);
          renderWidget();
        }
      }, 100);
    }

    return () => {
      if (pollId !== undefined) {
        window.clearInterval(pollId);
      }

      if (widgetId !== undefined) {
        window.turnstile?.remove(widgetId);
      }
    };
  }, [siteKey, language]);

  return <div ref={containerRef} />;
}
