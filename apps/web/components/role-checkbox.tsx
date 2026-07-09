"use client";

import { useTransition } from "react";

type RoleCheckboxProps = {
  userId: string;
  roleCode: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  addMessage: string;
  removeMessage: string;
  addRoleAction: (formData: FormData) => Promise<void>;
  removeRoleAction: (formData: FormData) => Promise<void>;
};

export function RoleCheckbox({
  userId,
  roleCode,
  label,
  checked,
  disabled = false,
  addMessage,
  removeMessage,
  addRoleAction,
  removeRoleAction,
}: RoleCheckboxProps) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="role-checkbox">
      <input
        checked={pending ? !checked : checked}
        disabled={disabled || pending}
        onChange={(event) => {
          const wantChecked = event.currentTarget.checked;
          const message = wantChecked ? addMessage : removeMessage;

          // Confirm before touching roles; on cancel snap the box back to its
          // server-truth state so the DOM never drifts from reality.
          if (!window.confirm(message)) {
            event.currentTarget.checked = checked;
            return;
          }

          const formData = new FormData();
          formData.set("userId", userId);
          formData.set("roleCode", roleCode);
          const action = wantChecked ? addRoleAction : removeRoleAction;

          startTransition(() => {
            void action(formData);
          });
        }}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}
