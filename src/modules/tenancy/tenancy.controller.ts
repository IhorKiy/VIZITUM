import { Controller, Get, Param } from "@nestjs/common";

import { TenancyService } from "./tenancy.service";

/**
 * Public (pre-auth) tenant lookup used by the web frontend to resolve the UI
 * locale and branding for a tenant workspace before the user is authenticated
 * (login and invite-accept pages). Exposes only slug, workspace name, language,
 * timezone, phone country, color scheme and a short-lived logo URL.
 */
@Controller("tenants")
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get(":slug/locale")
  getTenantLocale(@Param("slug") slug: string) {
    return this.tenancyService.getPublicTenantLocale(slug);
  }

  @Get(":slug/branding")
  getTenantBranding(@Param("slug") slug: string) {
    return this.tenancyService.getPublicTenantBranding(slug);
  }
}
