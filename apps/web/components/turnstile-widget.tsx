"use client";

import { useEffect, useRef } from "react";

// Explicit rendering (?render=explicit) instead of the implicit
// class="cf-turnstile" scan: the scan runs once at script load, so a widget
// mounted after a soft navigation (e.g. returning to the login page with
// ?error=...) would silently never appear.
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// The narrowest width Turnstile will render a widget at.
const MIN_WIDTH = 300;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: "light" | "dark";
      size?: "normal" | "flexible";
    },
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // "flexible" fills the field on a laptop, but Turnstile refuses to render
  // below MIN_WIDTH, and the login panel is narrower than that on a phone —
  // where the widget would otherwise be clipped, taking Cloudflare's logo and
  // privacy links with it. So below that width the widget is rendered at its
  // minimum and scaled down to whatever the field actually offers. `zoom`
  // rather than `transform` because it scales the layout box too, so the
  // field's height follows on its own.
  useEffect(() => {
    const field = fieldRef.current;
    const container = containerRef.current;

    if (!field || !container) {
      return;
    }

    const fitToField = () => {
      const available = field.getBoundingClientRect().width;

      if (available > 0 && available < MIN_WIDTH) {
        container.style.width = `${MIN_WIDTH}px`;
        container.style.zoom = String(available / MIN_WIDTH);
      } else {
        container.style.width = "";
        container.style.zoom = "";
      }
    };

    fitToField();

    const observer = new ResizeObserver(fitToField);
    observer.observe(field);

    return () => observer.disconnect();
  }, []);

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
        // The default "auto" follows the browser's dark-mode preference, but
        // the app has no dark theme — a dark widget on the light login panel
        // reads as a foreign element.
        theme: "light",
        // Cloudflare draws the widget's own frame and does not expose it to
        // page CSS, so matching the inputs means matching what it does
        // expose: "flexible" fills the form width the way they do, instead
        // of leaving a 300px box short of the field above it.
        size: "flexible",
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

  return (
    <div className="turnstile-field" ref={fieldRef}>
      <div ref={containerRef} />
    </div>
  );
}
