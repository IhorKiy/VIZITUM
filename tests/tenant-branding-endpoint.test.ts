import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TenancyService } from "../src/modules/tenancy/tenancy.service";

type FakeTenant = {
  id: string;
  slug: string;
  name?: string;
  status?: string;
};

function buildService(options?: {
  tenants?: FakeTenant[];
  settingRows?: { key: string; value: unknown }[];
  storageRow?: { bucket: string; objectKey: string } | null;
  presignedCalls?: unknown[];
}) {
  const tenants = options?.tenants ?? [
    { id: "tenant-a", slug: "acme", name: "Acme", status: "pilot" },
  ];
  const presignedCalls = options?.presignedCalls ?? [];

  const prisma = {
    platformTenant: {
      findUnique: async (query: { where: { slug: string } }) =>
        tenants.find((tenant) => tenant.slug === query.where.slug) ?? null,
    },
    tenantSetting: {
      findMany: async () => options?.settingRows ?? [],
    },
    storageObject: {
      findFirst: async () => options?.storageRow ?? null,
    },
  };

  const s3Storage = {
    createPresignedObjectUrl: (input: unknown) => {
      presignedCalls.push(input);
      return {
        url: "https://r2.example/logo?signed=1",
        expiresAt: new Date("2026-07-16T00:15:00.000Z"),
        headers: {},
      };
    },
  };

  return {
    service: new TenancyService(prisma as never, s3Storage as never),
    presignedCalls,
  };
}

describe("public tenant branding endpoint", () => {
  it("rejects an unknown slug with TENANT_NOT_FOUND", async () => {
    const { service } = buildService();

    await assert.rejects(
      () => service.getPublicTenantBranding("missing"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "TENANT_NOT_FOUND",
    );
  });

  it("rejects an empty slug", async () => {
    const { service } = buildService();

    await assert.rejects(
      () => service.getPublicTenantBranding("   "),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "TENANT_NOT_FOUND",
    );
  });

  it("normalizes the slug before lookup", async () => {
    const { service } = buildService();

    const branding = await service.getPublicTenantBranding("  ACME ");

    assert.equal(branding.slug, "acme");
  });

  it("returns emerald and no logo when nothing is configured", async () => {
    const { service } = buildService();

    const branding = await service.getPublicTenantBranding("acme");

    assert.deepEqual(branding, {
      slug: "acme",
      name: "Acme",
      colorScheme: "emerald",
      logoUrl: null,
    });
  });

  it("returns the stored tenant name with its case untouched", async () => {
    // The slug is lowercase by construction, so the name has to come off the
    // tenant row: deriving it from the slug turned "MG" into "Mg" on every
    // screen that names the workspace.
    const { service } = buildService({
      tenants: [{ id: "tenant-a", slug: "mg", name: "MG", status: "pilot" }],
    });

    const branding = await service.getPublicTenantBranding("mg");

    assert.equal(branding.name, "MG");
  });

  it("returns the stored color scheme", async () => {
    const { service } = buildService({
      settingRows: [{ key: "branding_color_scheme", value: "terracotta" }],
    });

    const branding = await service.getPublicTenantBranding("acme");

    assert.equal(branding.colorScheme, "terracotta");
  });

  it("mints a presigned GET URL for an active logo object", async () => {
    const { service, presignedCalls } = buildService({
      settingRows: [
        { key: "branding_logo_object_id", value: "object-current" },
      ],
      storageRow: {
        bucket: "vizitum",
        objectKey: "tenants/tenant-a/branding/logo/current/logo.png",
      },
    });

    const branding = await service.getPublicTenantBranding("acme");

    assert.equal(branding.logoUrl, "https://r2.example/logo?signed=1");
    assert.equal(
      (presignedCalls[0] as { method: string; objectKey: string }).method,
      "GET",
    );
  });

  it("returns logoUrl null when the pointed object is missing or inactive", async () => {
    const { service } = buildService({
      settingRows: [
        { key: "branding_logo_object_id", value: "object-gone" },
      ],
      storageRow: null,
    });

    const branding = await service.getPublicTenantBranding("acme");

    assert.equal(branding.logoUrl, null);
  });

  it("serves branding for suspended and archived tenants (login page must render)", async () => {
    const { service } = buildService({
      tenants: [
        { id: "tenant-a", slug: "acme", name: "Acme", status: "archived" },
      ],
    });

    const branding = await service.getPublicTenantBranding("acme");

    assert.equal(branding.colorScheme, "emerald");
  });
});
