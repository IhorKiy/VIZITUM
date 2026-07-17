"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

const TYPING_DEBOUNCE_MS = 400;

type FilterFormProps = {
  action: string;
  className?: string;
  children: ReactNode;
};

// Fields the user types into, which apply after a pause instead of per event:
// a search would otherwise fire a request per keystroke, and a date per typed
// segment — browsers emit input events for half-typed dates, passing through
// an empty value and bogus years (0002 on the way to 2026).
function isTypedField(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement &&
    (target.type === "text" ||
      target.type === "search" ||
      target.type === "date")
  );
}

// Filter form that applies on change instead of behind a submit button: selects
// navigate at once, typed fields (search, dates) wait for a pause in typing.
// Navigating with a soft, scroll-preserving router.replace keeps focus in the
// search field, keeps the page where the user scrolled it, and keeps filtering
// out of session history.
export function FilterForm({ action, className, children }: FilterFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const applyFilters = () => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value === "string" && value !== "") {
        params.append(name, value);
      }
    }
    const query = params.toString();
    router.replace(query ? `${action}?${query}` : action, { scroll: false });
  };

  return (
    <form
      action={action}
      className={className}
      onChange={(event) => {
        if (isTypedField(event.target)) {
          return;
        }
        clearTimeout(debounceRef.current);
        applyFilters();
      }}
      onClick={(event) => {
        // Date fields hide the native picker indicator and show one icon of
        // their own, so the whole input has to be what opens the picker.
        // showPicker throws without user activation or where unsupported —
        // typing the date still works either way.
        const target = event.target;
        if (target instanceof HTMLInputElement && target.type === "date") {
          try {
            target.showPicker();
          } catch {
            // No picker to show; the field stays typeable.
          }
        }
      }}
      onInput={(event) => {
        if (!isTypedField(event.target)) {
          return;
        }
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(applyFilters, TYPING_DEBOUNCE_MS);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(debounceRef.current);
        applyFilters();
      }}
      ref={formRef}
    >
      {children}
    </form>
  );
}
