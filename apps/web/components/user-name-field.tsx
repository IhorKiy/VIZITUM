"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { CheckIcon, CloseIcon, PencilIcon } from "./icons";

type UserNameFieldProps = {
  userId: string;
  name: string;
  canEdit: boolean;
  updateNameAction: (formData: FormData) => Promise<void>;
};

export function UserNameField({
  userId,
  name,
  canEdit,
  updateNameAction,
}: UserNameFieldProps) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // A successful rename redirects and RSC-refreshes the page without
  // remounting this component, so `editing` would otherwise stay true and
  // leave the input open. Exit edit mode whenever the name prop changes.
  useEffect(() => {
    setEditing(false);
  }, [name]);

  // The name sits inside the <summary>, which toggles the disclosure on any
  // click or Space/Enter — so every control here stops the event from reaching
  // the summary's default toggle.
  function stopToggle(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  function save() {
    const value = inputRef.current?.value.trim() ?? "";

    if (!value || value === name) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set("userId", userId);
    formData.set("name", value);
    startTransition(() => {
      void updateNameAction(formData);
    });
  }

  if (!canEdit) {
    return <h3>{name}</h3>;
  }

  if (!editing) {
    return (
      <div className="user-name-field">
        <h3>{name}</h3>
        <button
          aria-label={t("editName")}
          className="name-edit-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEditing(true);
          }}
          onMouseDown={stopToggle}
          title={t("editName")}
          type="button"
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  return (
    <div
      className="user-name-field editing"
      onClick={stopToggle}
      onMouseDown={stopToggle}
    >
      <input
        aria-label={t("editName")}
        className="user-name-input"
        defaultValue={name}
        disabled={pending}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
        ref={inputRef}
        type="text"
      />
      <button
        aria-label={tCommon("save")}
        className="name-edit-button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          save();
        }}
        onMouseDown={stopToggle}
        title={tCommon("save")}
        type="button"
      >
        <CheckIcon />
      </button>
      <button
        aria-label={t("cancelEdit")}
        className="name-edit-button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setEditing(false);
        }}
        onMouseDown={stopToggle}
        title={t("cancelEdit")}
        type="button"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
