"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { CheckIcon, CloseIcon, PencilIcon } from "./icons";

type UserNameFieldProps = {
  userId: string;
  firstName: string;
  // Null on rows backfilled from a legacy one-word name; editing one supplies
  // the surname the record never had.
  lastName: string | null;
  // Composed by the backend — what the row shows when it isn't being edited.
  displayName: string;
  canEdit: boolean;
  updateNameAction: (formData: FormData) => Promise<void>;
};

export function UserNameField({
  userId,
  firstName,
  lastName,
  displayName,
  canEdit,
  updateNameAction,
}: UserNameFieldProps) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      firstNameRef.current?.focus();
      firstNameRef.current?.select();
    }
  }, [editing]);

  // A successful rename redirects and RSC-refreshes the page without
  // remounting this component, so `editing` would otherwise stay true and
  // leave the inputs open. Exit edit mode whenever the name changes.
  // Adjusted during render (React's documented pattern for resetting state
  // when a prop changes) rather than in an effect, so there is no extra
  // render showing the stale editing state.
  const [prevDisplayName, setPrevDisplayName] = useState(displayName);
  if (displayName !== prevDisplayName) {
    setPrevDisplayName(displayName);
    setEditing(false);
  }

  // The name sits inside the <summary>, which toggles the disclosure on any
  // click or Space/Enter — so every control here stops the event from reaching
  // the summary's default toggle.
  function stopToggle(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  function save() {
    const nextFirstName = firstNameRef.current?.value.trim() ?? "";
    const nextLastName = lastNameRef.current?.value.trim() ?? "";
    const unchanged =
      nextFirstName === firstName && nextLastName === (lastName ?? "");

    // A blank surname would be a silent no-op on the server (it only applies
    // non-empty parts), so treat it the same as cancelling rather than
    // pretending the edit saved.
    if (!nextFirstName || !nextLastName || unchanged) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set("userId", userId);
    formData.set("firstName", nextFirstName);
    formData.set("lastName", nextLastName);
    startTransition(() => {
      void updateNameAction(formData);
    });
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  }

  if (!canEdit) {
    return <h3>{displayName}</h3>;
  }

  if (!editing) {
    return (
      <div className="user-name-field">
        <h3>{displayName}</h3>
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
        aria-label={t("editFirstName")}
        className="user-name-input"
        defaultValue={firstName}
        disabled={pending}
        maxLength={INPUT_LIMITS.name}
        onKeyDown={onFieldKeyDown}
        placeholder={t("editFirstName")}
        ref={firstNameRef}
        type="text"
      />
      <input
        aria-label={t("editLastName")}
        className="user-name-input"
        defaultValue={lastName ?? ""}
        disabled={pending}
        maxLength={INPUT_LIMITS.name}
        onKeyDown={onFieldKeyDown}
        placeholder={t("editLastName")}
        ref={lastNameRef}
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
