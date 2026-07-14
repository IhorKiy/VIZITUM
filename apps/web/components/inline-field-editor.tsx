"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { CheckIcon, CloseIcon, PencilIcon } from "./icons";

type Option = { value: string; label: string };

// Message namespaces wired to this editor; each must provide `editField` and
// `cancelEdit`. Add a namespace here when a new screen adopts the editor.
type EditorNamespace = "admin.products" | "admin.chains";

type InlineFieldEditorProps = {
  // Id of the entity being edited and the form field name it is submitted under
  // (e.g. "productId" or "chainId"), so one editor works across screens.
  entityId: string;
  idFieldName: string;
  field: string;
  label: string;
  // Raw value that drives the control (input text or option value).
  value: string;
  // Read-only text shown when not editing (localized label for selects).
  displayText: string;
  kind: "text" | "select";
  options?: Option[];
  required?: boolean;
  placeholder?: string;
  // Translation namespace that provides `editField` and `cancelEdit`.
  namespace: EditorNamespace;
  updateAction: (formData: FormData) => Promise<void>;
};

export function InlineFieldEditor({
  entityId,
  idFieldName,
  field,
  label,
  value,
  displayText,
  kind,
  options,
  required = false,
  placeholder,
  namespace,
  updateAction,
}: InlineFieldEditorProps) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) {
      return;
    }

    if (kind === "select") {
      selectRef.current?.focus();
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, kind]);

  // A successful save redirects and RSC-refreshes the page without remounting
  // this component, so `editing` would otherwise stay true. Exit edit mode
  // whenever the incoming value changes.
  useEffect(() => {
    setEditing(false);
  }, [value]);

  function save() {
    const raw =
      (kind === "select"
        ? selectRef.current?.value
        : inputRef.current?.value) ?? "";
    const next = kind === "select" ? raw : raw.trim();

    if (required && !next) {
      setEditing(false);
      return;
    }

    if (next === value) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set(idFieldName, entityId);
    formData.set(field, next);
    startTransition(() => {
      void updateAction(formData);
    });
  }

  if (!editing) {
    return (
      <div className="product-field">
        <span className="product-field-label">{label}</span>
        <div className="product-field-view">
          <span
            className={`product-field-value${displayText ? "" : " is-empty"}`}
          >
            {displayText || placeholder || "—"}
          </span>
          <button
            aria-label={t("editField", { field: label })}
            className="name-edit-button"
            disabled={pending}
            onClick={() => setEditing(true)}
            title={t("editField", { field: label })}
            type="button"
          >
            <PencilIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="product-field">
      <span className="product-field-label">{label}</span>
      <div className="product-field-edit">
        {kind === "select" ? (
          <select
            aria-label={label}
            defaultValue={value}
            disabled={pending}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            ref={selectRef}
          >
            {options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={label}
            defaultValue={value}
            disabled={pending}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            placeholder={placeholder}
            ref={inputRef}
          />
        )}
        <button
          aria-label={tCommon("save")}
          className="name-edit-button"
          disabled={pending}
          onClick={save}
          title={tCommon("save")}
          type="button"
        >
          <CheckIcon />
        </button>
        <button
          aria-label={t("cancelEdit")}
          className="name-edit-button"
          disabled={pending}
          onClick={() => setEditing(false)}
          title={t("cancelEdit")}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
