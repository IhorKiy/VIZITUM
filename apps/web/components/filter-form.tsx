"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

const SEARCH_DEBOUNCE_MS = 400;

type FilterFormProps = {
  action: string;
  className?: string;
  children: ReactNode;
};

function isFreeTextField(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement &&
    (target.type === "text" || target.type === "search")
  );
}

// Filter form that applies on change instead of behind a submit button: selects
// and dates navigate at once, free-text search waits for a pause in typing so a
// request does not fire per keystroke. Navigating with a soft router.replace
// keeps focus in the search field and keeps filtering out of session history.
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
    router.replace(query ? `${action}?${query}` : action);
  };

  return (
    <form
      action={action}
      className={className}
      onChange={(event) => {
        if (isFreeTextField(event.target)) {
          return;
        }
        clearTimeout(debounceRef.current);
        applyFilters();
      }}
      onInput={(event) => {
        if (!isFreeTextField(event.target)) {
          return;
        }
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS);
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
