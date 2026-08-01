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

  // "flexible" fills the field at any width the panel actually offers, which
  // on phones is every common screen. Below MIN_WIDTH Turnstile refuses to
  // render narrower, and clipping it would cut off Cloudflare's logo and
  // privacy links, so there the widget renders at its minimum and is scaled to
  // the field. `zoom` rather than `transform` because it scales the layout box
  // too, so the field's height follows on its own.
  //
  // Scaling is a last resort, not the phone path: it shrinks the widget's own
  // hit target, and because the trigger is CSS pixels it would otherwise fire
  // for a desktop reader at 400% browser zoom — shrinking the one element they
  // had just enlarged. The narrow-screen padding in globals.css keeps the field
  // above MIN_WIDTH on every common phone so this stays unused.
  useEffect(() => {
    const field = fieldRef.current;
    const container = containerRef.current;

    if (!field || !container) {
      return;
    }

    const fitToField = () => {
      // clientWidth, not getBoundingClientRect(): the container sits in the
      // content box, and a border-box width would size it 2px wider than the
      // space it has — straight into the clip.
      const available = field.clientWidth;

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
