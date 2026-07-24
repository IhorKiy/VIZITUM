"use client";

import { useEffect, useRef, useState } from "react";

import {
  dialCodeForCountry,
  formatPhoneForDisplay,
  normalizePhoneInput,
} from "../lib/phone";

type PhoneInputProps = {
  // Form field name — the hidden input below carries the E.164 value under
  // this name, so server actions keep reading their existing field names.
  name: string;
  // Stored value (E.164, or a legacy un-normalized string).
  defaultValue?: string | null;
  // Tenant's ISO alpha-2 phone country; null means only "+"-international
  // input is accepted.
  phoneCountry: string | null;
  required?: boolean;
  // Validation messages, passed in so tenant zones translate them while the
  // platform zone keeps its English literals.
  invalidMessage: string;
  countryRequiredMessage: string;
  placeholder?: string;
  autoComplete?: string;
};

// Text input that accepts a national number of the tenant's phoneCountry or
// any "+"-international number, validates via libphonenumber-js, and submits
// E.164. The visible input shows the human-formatted number; the hidden input
// carries the canonical value. Validity is surfaced through the browser's
// constraint validation (setCustomValidity), which blocks submission and
// shows the message on the field.
//
// A pristine (never-edited) field passes the stored value through untouched
// and is never flagged: a record whose legacy phone predates validation must
// stay editable as long as the phone itself isn't being changed — the backend
// applies the same rule.
export function PhoneInput({
  name,
  defaultValue,
  phoneCountry,
  required,
  invalidMessage,
  countryRequiredMessage,
  placeholder,
  autoComplete,
}: PhoneInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  const [display, setDisplay] = useState(
    () => formatPhoneForDisplay(defaultValue ?? null, phoneCountry) ?? "",
  );
  const [e164, setE164] = useState(defaultValue ?? "");

  function applyValue(raw: string, reformat: boolean) {
    if (!dirtyRef.current) {
      inputRef.current?.setCustomValidity("");
      return;
    }

    const normalized = normalizePhoneInput(raw, phoneCountry);

    if (!normalized.ok) {
      // Keep the raw text in the submitted field so the server stays the
      // validation authority even if the browser bubble is bypassed.
      setE164(raw);
      inputRef.current?.setCustomValidity(
        normalized.reason === "country_required"
          ? countryRequiredMessage
          : invalidMessage,
      );
      return;
    }

    inputRef.current?.setCustomValidity("");
    setE164(normalized.e164 ?? "");

    if (reformat && normalized.e164) {
      setDisplay(formatPhoneForDisplay(normalized.e164, phoneCountry) ?? "");
    }
  }

  // The platform create-tenant form lets the owner change the phone country
  // while the phone is already filled in — revalidate against the new country.
  useEffect(() => {
    if (inputRef.current) {
      applyValue(inputRef.current.value, true);
    }
  }, [phoneCountry]);

  // form.reset() (used by the contact modal's cancel/close) fires no React
  // change event, so restore the controlled state ourselves.
  useEffect(() => {
    const form = inputRef.current?.form;

    if (!form) {
      return;
    }

    const onReset = () => {
      dirtyRef.current = false;
      setDisplay(
        formatPhoneForDisplay(defaultValue ?? null, phoneCountry) ?? "",
      );
      setE164(defaultValue ?? "");
      inputRef.current?.setCustomValidity("");
    };

    form.addEventListener("reset", onReset);

    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue, phoneCountry]);

  const dialCode = dialCodeForCountry(phoneCountry);

  return (
    <>
      <input name={name} type="hidden" value={e164} />
      <input
        autoComplete={autoComplete ?? "tel"}
        onBlur={(event) => applyValue(event.target.value, true)}
        onChange={(event) => {
          dirtyRef.current = true;
          setDisplay(event.target.value);
          applyValue(event.target.value, false);
        }}
        placeholder={placeholder ?? dialCode ?? "+"}
        ref={inputRef}
        required={required}
        type="tel"
        value={display}
      />
      {dialCode ? (
        <span aria-hidden="true" className="form-hint">
          {dialCode}
        </span>
      ) : null}
    </>
  );
}
