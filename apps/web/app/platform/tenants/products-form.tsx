"use client";

import { SelectFieldForm } from "./select-field-form";

type ProductsFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentEnabled: boolean;
  tenantId: string;
  tenantName: string;
};

export function ProductsForm({
  action,
  currentEnabled,
  tenantId,
  tenantName,
}: ProductsFormProps) {
  return (
    <SelectFieldForm
      action={action}
      confirmLabel="Confirm product tracking"
      currentValue={currentEnabled ? "true" : "false"}
      description={
        "When enabled, this tenant's admins see the Products area and can " +
        "manage products/SKUs. When disabled, the Products area is hidden."
      }
      dialogId="tenant-products-title"
      eyebrow="Tenant products"
      fieldLabel="Product/SKU tracking"
      inputName="productsEnabled"
      options={[
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ]}
      tenantId={tenantId}
      title="Change product tracking"
      triggerLabel={`Edit product tracking for ${tenantName}`}
    />
  );
}
