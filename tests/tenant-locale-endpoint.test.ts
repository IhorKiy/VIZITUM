import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TenancyService } from "../src/modules/tenancy/tenancy.service";

function buildService(
  tenants: Array<{
    slug: string;
    language: string;
    timezone: string;
    phoneCountry?: string | null;
  }>,
) {
  return new TenancyService({
    platformTenant: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        const tenant = tenants.find((entry) => entry.slug === where.slug);

        return tenant ? { phoneCountry: null, ...tenant } : null;
      },
    },
  } as never);
}

describe("public tenant locale lookup", () => {
  it("returns slug, language, timezone and phone country for an existing tenant", async () => {
    const service = buildService([
      {
        slug: "acme",
        language: "uk",
        timezone: "Europe/Kyiv",
        phoneCountry: "UA",
      },
    ]);

    const locale = await service.getPublicTenantLocale("acme");

    assert.deepEqual(locale, {
      slug: "acme",
      language: "uk",
      timezone: "Europe/Kyiv",
      phoneCountry: "UA",
    });
  });

  it("returns a null phone country for a legacy tenant that has none", async () => {
    const service = buildService([
      { slug: "acme", language: "uk", timezone: "Europe/Kyiv" },
    ]);

    const locale = await service.getPublicTenantLocale("acme");

    assert.equal(locale.phoneCountry, null);
  });

  it("normalizes the slug before lookup", async () => {
    const service = buildService([
      { slug: "acme", language: "en", timezone: "UTC" },
    ]);

    const locale = await service.getPublicTenantLocale("  ACME ");

    assert.equal(locale.slug, "acme");
    assert.equal(locale.language, "en");
  });

  it("throws TENANT_NOT_FOUND for an unknown slug", async () => {
    const service = buildService([]);

    await assert.rejects(
      service.getPublicTenantLocale("missing"),
      (error: { response?: { code?: string } }) => {
        assert.equal(error.response?.code, "TENANT_NOT_FOUND");
        return true;
      },
    );
  });

  it("throws TENANT_NOT_FOUND for an empty slug", async () => {
    const service = buildService([]);

    await assert.rejects(
      service.getPublicTenantLocale("   "),
      (error: { response?: { code?: string } }) => {
        assert.equal(error.response?.code, "TENANT_NOT_FOUND");
        return true;
      },
    );
  });
});
