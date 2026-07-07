import { Controller, Get, Param } from "@nestjs/common";

import { TenancyService } from "./tenancy.service";

/**
 * Public (pre-auth) tenant lookup used by the web frontend to resolve the UI
 * locale for a tenant workspace before the user is authenticated (login and
 * invite-accept pages). Exposes only slug, language and timezone.
 */
@Controller("tenants")
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get(":slug/locale")
  getTenantLocale(@Param("slug") slug: string) {
    return this.tenancyService.getPublicTenantLocale(slug);
  }
}
