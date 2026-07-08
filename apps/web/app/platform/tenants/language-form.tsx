"use client";

import { useRef, useState } from "react";

// Platform screens stay English by design; only the option labels name the
// languages themselves.
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English (en)" },
  { value: "uk", label: "Ukrainian (uk)" },
];

type LanguageFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentLanguage: string;
  tenantId: string;
};

export function LanguageForm({
  action,
  currentLanguage,
  tenantId,
}: LanguageFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [language, setLanguage] = useState(currentLanguage);
  const options = LANGUAGE_OPTIONS.some(
    (option) => option.value === currentLanguage,
  )
    ? LANGUAGE_OPTIONS
    : [
        { value: currentLanguage, label: currentLanguage },
        ...LANGUAGE_OPTIONS,
      ];
  const canSubmit = Boolean(language) && language !== currentLanguage;

  function openDialog() {
    setLanguage(currentLanguage);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-timezone-form">
      <button className="secondary-button" onClick={openDialog} type="button">
        Change language
      </button>
      <dialog
        aria-labelledby={`tenant-language-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant language</p>
            <h2 id={`tenant-language-title-${tenantId}`}>Change language</h2>
          </div>
          <button
            aria-label="Close language modal"
            className="icon-button"
            disabled={isSaving}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <form
          action={action}
          className="visit-form compact modal-form"
          onSubmit={() => setIsSaving(true)}
        >
          <input name="tenantId" type="hidden" value={tenantId} />
          <label>
            Workspace UI language
            <select
              name="language"
              onChange={(event) => setLanguage(event.target.value)}
              required
              value={language}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="tenant-status-confirmation">
            Every screen of this tenant workspace, including sign-in, renders
            in this language.
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={isSaving}
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={isSaving || !canSubmit}
              type="submit"
            >
              {isSaving ? "Saving..." : "Confirm language"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
