"use client";

import { useRef, useState } from "react";

import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { PhoneInput } from "../../../../components/phone-input";
import type { PlatformSegmentTemplate } from "../../../../lib/api-client";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import {
  defaultTimezoneOption,
  listTimezones,
} from "../../../../lib/timezones";
import { DEFAULT_TENANT_LANGUAGE, LANGUAGE_OPTIONS } from "./language-options";
import { phoneCountryOptions } from "./phone-country-options";

const DEFAULT_PHONE_COUNTRY = "UA";

type CreateTenantModalProps = {
  action: (formData: FormData) => Promise<void>;
  segmentTemplates: PlatformSegmentTemplate[];
};

export function CreateTenantModal({
  action,
  segmentTemplates,
}: CreateTenantModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timezones = listTimezones();
  const defaultTimezone = defaultTimezoneOption(timezones);
  // The contact phone validates against the selected phone country live, so
  // the select is controlled state rather than a plain uncontrolled field.
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Create tenant
      </button>

      <dialog
        aria-labelledby="create-tenant-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Platform</p>
            <h2 id="create-tenant-title">Create tenant</h2>
          </div>
          <button
            aria-label="Close create tenant modal"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            Name
            <input
              maxLength={INPUT_LIMITS.name}
              name="name"
              required
              type="text"
            />
          </label>
          <label>
            Slug
            <input
              maxLength={INPUT_LIMITS.slug}
              name="slug"
              required
              type="text"
            />
          </label>
          <label>
            Segment template
            <select name="segmentTemplate" required defaultValue="">
              <option value="" disabled>
                Select a template
              </option>
              {segmentTemplates.map((template) => (
                <option key={template} value={template}>
                  {template}
                </option>
              ))}
            </select>
          </label>
          <label>
            Country
            <input
              maxLength={INPUT_LIMITS.country}
              name="country"
              placeholder="UA"
              type="text"
            />
          </label>
          <label>
            Timezone
            <select name="timezone" defaultValue={defaultTimezone} required>
              {timezones.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>
          <label>
            Language
            <select
              name="language"
              defaultValue={DEFAULT_TENANT_LANGUAGE}
              required
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contact name
            <input
              maxLength={INPUT_LIMITS.name}
              name="contactName"
              required
              type="text"
            />
          </label>
          <label>
            Contact email
            <input
              maxLength={INPUT_LIMITS.email}
              name="contactEmail"
              required
              type="email"
            />
          </label>
          <label>
            Phone country
            <select
              name="phoneCountry"
              onChange={(event) => setPhoneCountry(event.target.value)}
              required
              value={phoneCountry}
            >
              {phoneCountryOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contact phone
            <PhoneInput
              countryRequiredMessage="Enter the phone in international format starting with +."
              invalidMessage="Enter a valid phone number."
              name="contactPhone"
              phoneCountry={phoneCountry}
              required
            />
          </label>
          <label>
            Primary domain
            <input
              maxLength={INPUT_LIMITS.domain}
              name="primaryDomain"
              type="text"
            />
          </label>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <PendingSubmitButton className="primary-button">
              Create tenant
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
