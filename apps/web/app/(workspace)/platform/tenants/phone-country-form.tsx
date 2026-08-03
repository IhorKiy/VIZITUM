import { phoneCountryOptions } from "./phone-country-options";
import { SingleFieldForm } from "./single-field-form";

type PhoneCountryFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  tenantId: string;
  currentValue: string | null;
  tenantName: string;
};

// Owner-side editor for the tenant's default phone country: a SingleFieldForm
// rendered as a select of every country libphonenumber-js ships metadata for.
// Submits through the same field/value contact-update action as the other
// contact fields.
export function PhoneCountryForm({
  action,
  tenantId,
  currentValue,
  tenantName,
}: PhoneCountryFormProps) {
  return (
    <SingleFieldForm
      action={action}
      confirmLabel="Confirm"
      currentValue={currentValue}
      dialogId="tenant-phoneCountry-title"
      eyebrow="Tenant country"
      fieldLabel="Phone country"
      hiddenFields={{ field: "phoneCountry" }}
      inputName="value"
      options={phoneCountryOptions()}
      tenantId={tenantId}
      title="Change phone country"
      triggerLabel={`Edit phone country for ${tenantName}`}
    />
  );
}
