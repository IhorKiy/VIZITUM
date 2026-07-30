"use client";

import { useId, useRef, useState } from "react";

import { EyeIcon, EyeOffIcon } from "./icons";
import { INPUT_LIMITS } from "../lib/input-limits";

type PasswordFieldsProps = {
  // Form field name of the real password; the confirmation is never submitted.
  name: string;
  label: string;
  confirmLabel: string;
  // Shown on the confirmation field while the two entries differ.
  mismatchMessage: string;
  // Reveal-toggle labels, passed in so tenant zones translate them.
  showLabel: string;
  hideLabel: string;
  minLength?: number;
};

// Password entry with a confirmation field and a reveal toggle, for the
// account-creation flows where the password is typed blind and a typo would
// lock the person out of the workspace they were just invited to.
//
// The confirmation is a browser-side guard only: it carries no name, so the
// server action never receives it, and the mismatch surfaces through
// constraint validation (setCustomValidity), which blocks submission the same
// way `required` does. Revealing applies to both fields at once — the point of
// looking is comparing what was typed.
export function PasswordFields({
  name,
  label,
  confirmLabel,
  mismatchMessage,
  showLabel,
  hideLabel,
  minLength,
}: PasswordFieldsProps) {
  const fieldId = useId();
  const passwordId = `${fieldId}-password`;
  const confirmId = `${fieldId}-confirm`;
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);

  // An untouched confirmation is not "wrong yet" — `required` already covers
  // the empty case, and flagging it mid-typing would fight the person filling
  // the form.
  function checkMatch() {
    const confirmInput = confirmRef.current;

    if (!confirmInput) {
      return;
    }

    const mismatch =
      confirmInput.value.length > 0 &&
      confirmInput.value !== (passwordRef.current?.value ?? "");

    confirmInput.setCustomValidity(mismatch ? mismatchMessage : "");
  }

  const inputType = revealed ? "text" : "password";
  const toggleLabel = revealed ? hideLabel : showLabel;

  return (
    <>
      <div className="password-field">
        <label htmlFor={passwordId}>{label}</label>
        <div className="password-field-control">
          <input
            autoComplete="new-password"
            id={passwordId}
            maxLength={INPUT_LIMITS.password}
            minLength={minLength}
            name={name}
            onChange={checkMatch}
            ref={passwordRef}
            required
            type={inputType}
          />
          <button
            aria-label={toggleLabel}
            aria-pressed={revealed}
            className="password-reveal"
            onClick={() => setRevealed((current) => !current)}
            title={toggleLabel}
            type="button"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>
      <div className="password-field">
        <label htmlFor={confirmId}>{confirmLabel}</label>
        <div className="password-field-control">
          <input
            autoComplete="new-password"
            id={confirmId}
            maxLength={INPUT_LIMITS.password}
            minLength={minLength}
            onChange={checkMatch}
            ref={confirmRef}
            required
            type={inputType}
          />
        </div>
      </div>
    </>
  );
}
