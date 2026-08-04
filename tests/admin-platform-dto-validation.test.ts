import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { PlatformController } from "../src/modules/platform/platform.controller";
import {
  CreateTenantDto,
  InviteTenantSuperadminDto,
  PromoteTenantSuperadminDto,
  RequestTenantPurgeDto,
  UpdateTenantDto,
} from "../src/modules/platform/platform.dto";
import { PlatformTenantSuperadminController } from "../src/modules/platform/platform-tenant-superadmin.controller";
import { AdminSettingsController } from "../src/modules/settings/admin-settings.controller";
import {
  ConfirmLogoUploadDto,
  RegisterLogoUploadDto,
  UpdateTenantSettingsDto,
} from "../src/modules/settings/settings.dto";
import { StorageController } from "../src/modules/storage/storage.controller";
import { CreatePresignedUrlDto } from "../src/modules/storage/storage.dto";
import { AdminUsersController } from "../src/modules/users/admin-users.controller";
import {
  AddUserRoleDto,
  InviteUserDto,
  UpdateUserDto,
} from "../src/modules/users/users.dto";

// Tier 4 of the class-validator DTO track (2.4 in
// docs/security-remediation-plan.md): the administrative surfaces — five
// controllers, thirteen write routes, eleven DTO classes. One file, because
// what these routes share is the thing worth pinning: they are the ones where
// a whitelist mismatch costs an admin action.
//
// As in the earlier tiers' files, the transform cases run the real
// ValidationPipe with the metadata Nest attaches to a @Body() parameter, and a
// separate case reads PIPES_METADATA off the handlers — including the ungated
// ones, so a decorator on the wrong route fails here.

type DtoClass = new () => object;

function bodyMetadata(metatype: DtoClass): ArgumentMetadata {
  return { type: "body", metatype, data: "" };
}

async function accept<T extends object>(
  metatype: new () => T,
  body: unknown,
): Promise<T> {
  const result = await createStrictValidationPipe().transform(
    body,
    bodyMetadata(metatype),
  );

  assert.ok(result instanceof metatype);

  return result as T;
}

async function reject(
  metatype: DtoClass,
  body: unknown,
  field: string,
): Promise<void> {
  await assert.rejects(
    createStrictValidationPipe().transform(body, bodyMetadata(metatype)),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);

      const response = error.getResponse() as {
        code?: string;
        fieldErrors?: Record<string, string[]>;
      };

      assert.equal(response.code, "VALIDATION_FAILED");
      assert.ok(
        response.fieldErrors?.[field]?.length,
        `expected a field error on ${field}, got ${JSON.stringify(response.fieldErrors)}`,
      );

      return true;
    },
  );
}

const EVERY_DTO: DtoClass[] = [
  UpdateTenantSettingsDto,
  RegisterLogoUploadDto,
  ConfirmLogoUploadDto,
  InviteUserDto,
  UpdateUserDto,
  AddUserRoleDto,
  CreatePresignedUrlDto,
  CreateTenantDto,
  UpdateTenantDto,
  RequestTenantPurgeDto,
  InviteTenantSuperadminDto,
  PromoteTenantSuperadminDto,
];

describe("every tier-4 write route with a body carries the pipe", () => {
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    [
      "settings.updateSettings",
      AdminSettingsController.prototype.updateSettings,
    ],
    [
      "settings.registerLogoUpload",
      AdminSettingsController.prototype.registerLogoUpload,
    ],
    [
      "settings.confirmLogoUpload",
      AdminSettingsController.prototype.confirmLogoUpload,
    ],
    ["users.inviteUser", AdminUsersController.prototype.inviteUser],
    ["users.updateUser", AdminUsersController.prototype.updateUser],
    ["users.addRole", AdminUsersController.prototype.addRole],
    [
      "storage.createPresignedUploadUrl",
      StorageController.prototype.createPresignedUploadUrl,
    ],
    [
      "storage.createPresignedDownloadUrl",
      StorageController.prototype.createPresignedDownloadUrl,
    ],
    ["platform.createTenant", PlatformController.prototype.createTenant],
    ["platform.updateTenant", PlatformController.prototype.updateTenant],
    [
      "platform.requestTenantPurge",
      PlatformController.prototype.requestTenantPurge,
    ],
    [
      "superadmin.inviteOrReplaceSuperadmin",
      PlatformTenantSuperadminController.prototype.inviteOrReplaceSuperadmin,
    ],
    [
      "superadmin.promoteToSuperadmin",
      PlatformTenantSuperadminController.prototype.promoteToSuperadmin,
    ],
  ];

  // Every route on those five controllers that takes no @Body(). A pipe here
  // would be whitelist applied to a body no DTO describes — and the archive /
  // unarchive pair is the case that matters, since apps/web posts `{}` to
  // both.
  const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["settings.getSettings", AdminSettingsController.prototype.getSettings],
    ["settings.removeLogo", AdminSettingsController.prototype.removeLogo],
    ["users.listUsers", AdminUsersController.prototype.listUsers],
    ["users.listInvites", AdminUsersController.prototype.listInvites],
    ["users.resendInvite", AdminUsersController.prototype.resendInvite],
    ["users.removeRole", AdminUsersController.prototype.removeRole],
    ["users.deleteUser", AdminUsersController.prototype.deleteUser],
    ["storage.getStorageObject", StorageController.prototype.getStorageObject],
    ["platform.listTenants", PlatformController.prototype.listTenants],
    ["platform.getTenant", PlatformController.prototype.getTenant],
    ["platform.archiveTenant", PlatformController.prototype.archiveTenant],
    ["platform.unarchiveTenant", PlatformController.prototype.unarchiveTenant],
    [
      "superadmin.getSuperadmin",
      PlatformTenantSuperadminController.prototype.getSuperadmin,
    ],
  ];

  it("attaches a pipe to all thirteen body handlers, and to none of the other thirteen", () => {
    for (const [name, handler] of gatedHandlers) {
      const pipes: unknown[] =
        Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

      assert.equal(pipes.length, 1, `${name} should carry exactly one pipe`);
    }

    for (const [name, handler] of ungatedHandlers) {
      assert.equal(
        Reflect.getMetadata(PIPES_METADATA, handler),
        undefined,
        `${name} takes no body and should carry no pipe`,
      );
    }
  });
});

describe("tier-4 DTOs: what all twelve classes share", () => {
  it("refuses an undeclared property on every route in the tier", async () => {
    for (const dto of EVERY_DTO) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }
  });

  it("lets an omitted field stay omitted, so the services keep owning required-ness", async () => {
    // "Email and at least one valid role are required." is still
    // INVITE_INVALID from users.service.ts, not VALIDATION_FAILED here.
    for (const dto of EVERY_DTO) {
      await accept(dto, {});
    }
  });

  it("refuses the request-scoped fields the platform controller supplies itself", async () => {
    // The controller spreads `...body` and then sets these from the request.
    // Before the pipe, a body carrying either was silently overwritten; now it
    // never reaches the spread.
    await reject(
      CreateTenantDto,
      { actorUserId: "someone-else" },
      "actorUserId",
    );
    await reject(UpdateTenantDto, { requestId: "forged" }, "requestId");
    await reject(
      InviteTenantSuperadminDto,
      { actorUserId: "someone-else" },
      "actorUserId",
    );
  });
});

describe("AdminSettingsController's three bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    // From apps/web: the settings screen patches one field at a time, and
    // uploadTenantLogo registers then confirms.
    await accept(UpdateTenantSettingsDto, { colorScheme: "ocean" });
    await accept(UpdateTenantSettingsDto, { locationCategoriesEnabled: true });
    await accept(UpdateTenantSettingsDto, {
      fieldReportVoiceHint: "Ask about",
    });
    await accept(UpdateTenantSettingsDto, {
      name: "Acme",
      timezone: "Europe/Kyiv",
      language: "uk",
      productsEnabled: false,
    });
    await accept(RegisterLogoUploadDto, {
      fileName: "logo.png",
      contentType: "image/png",
      sizeBytes: 20_480,
    });
    await accept(ConfirmLogoUploadDto, { storageObjectId: "obj-1" });
  });

  it("refuses a name past the cap normalizeName already enforced silently", async () => {
    // Before this, an over-long name came back "Company name must not be
    // empty." — true only in the sense that the value was discarded.
    await accept(UpdateTenantSettingsDto, { name: "a".repeat(200) });
    await reject(UpdateTenantSettingsDto, { name: "a".repeat(201) }, "name");
  });

  it("keeps the enumerating refusals with the service", async () => {
    // Both messages name the allowed values ("Choose one of: en, uk."), which
    // a whitelist rejection would replace with nothing. SETTINGS_INVALID stays
    // the answer.
    await accept(UpdateTenantSettingsDto, { language: "de" });
    await accept(UpdateTenantSettingsDto, { colorScheme: "not-a-preset" });
  });

  it("treats null as clear-this-field where the service does", async () => {
    await accept(UpdateTenantSettingsDto, { fieldReportVoiceHint: null });
  });

  it("refuses a non-boolean toggle", async () => {
    await reject(
      UpdateTenantSettingsDto,
      { productsEnabled: "true" },
      "productsEnabled",
    );
  });

  it("leaves the logo size arithmetic to the service, string form included", async () => {
    // "Logo size must be a positive integer up to 1 MB." is what an admin with
    // an over-large PNG needs, so BRANDING_LOGO_SIZE_INVALID still owns the
    // cap — and a client sending "20480" must keep getting a signable PUT.
    await accept(RegisterLogoUploadDto, { sizeBytes: 2_000_000 });
    await accept(RegisterLogoUploadDto, { sizeBytes: "20480" });
    await reject(RegisterLogoUploadDto, { sizeBytes: {} }, "sizeBytes");
  });

  it("leaves contentType free, since it falls back to the extension", async () => {
    await accept(RegisterLogoUploadDto, {
      fileName: "logo.png",
      contentType: "application/octet-stream",
    });
  });
});

describe("AdminUsersController's three bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    await accept(InviteUserDto, {
      email: "rep@example.com",
      roleCodes: ["field_representative"],
    });
    await accept(UpdateUserDto, { status: "suspended" });
    await accept(UpdateUserDto, { firstName: "Olena", lastName: "Kovalchuk" });
    await accept(AddUserRoleDto, { roleCode: "team_manager" });
  });

  it("refuses a typo'd role inside an otherwise valid array", async () => {
    // The tier's dropped-enum rule at its quietest: normalizeRoleCodes filtered
    // the typo out and invited the person as a rep alone, answering 200.
    await reject(
      InviteUserDto,
      {
        email: "rep@example.com",
        roleCodes: ["field_representative", "compny_admin"],
      },
      "roleCodes",
    );
  });

  it("refuses a role this route was never allowed to grant", async () => {
    // tenant_superadmin is the platform owner's to hand out.
    await reject(
      InviteUserDto,
      { roleCodes: ["tenant_superadmin"] },
      "roleCodes",
    );
    await reject(AddUserRoleDto, { roleCode: "tenant_superadmin" }, "roleCode");
  });

  it("refuses a status outside the set, which used to be a silent no-op", async () => {
    // normalizeUserStatus dropped it to null and `status ? { status } : {}`
    // wrote nothing: a typo left a suspended admin active, with a 200.
    await reject(UpdateUserDto, { status: "suspend" }, "status");
    await accept(UpdateUserDto, { status: "invited" });
  });

  it("caps the name parts at the normalizer's own limit", async () => {
    await accept(UpdateUserDto, { firstName: "a".repeat(120) });
    await reject(UpdateUserDto, { firstName: "a".repeat(121) }, "firstName");
    await reject(UpdateUserDto, { lastName: "a".repeat(121) }, "lastName");
  });

  it("leaves the phone uncapped and clearable", async () => {
    // updateUser passes an *unchanged* phone through unvalidated so a legacy
    // row stays editable; a cap here would refuse the admin screen's own
    // round-trip of that stored value.
    await accept(UpdateUserDto, { phone: "+380".padEnd(60, "0") });
    await accept(UpdateUserDto, { phone: null });
    await reject(UpdateUserDto, { phone: 380_501_234_567 }, "phone");
  });
});

describe("StorageController's two bodies", () => {
  it("accepts what the TTL normalizer accepts, string and empty included", async () => {
    await accept(CreatePresignedUrlDto, { expiresInSeconds: 300 });
    await accept(CreatePresignedUrlDto, { expiresInSeconds: "300" });
    await accept(CreatePresignedUrlDto, { expiresInSeconds: "" });
    await accept(CreatePresignedUrlDto, { expiresInSeconds: null });
  });

  it("leaves the 1..900 range to the service, whose message names it", async () => {
    await accept(CreatePresignedUrlDto, { expiresInSeconds: 100_000 });
    await reject(
      CreatePresignedUrlDto,
      { expiresInSeconds: {} },
      "expiresInSeconds",
    );
  });
});

describe("the two platform controllers' five bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    await accept(CreateTenantDto, {
      name: "Acme",
      slug: "acme",
      segmentTemplate: "distribution",
      country: "UA",
      timezone: "Europe/Kyiv",
      language: "uk",
      contactName: "Olena Kovalchuk",
      contactEmail: "olena@example.com",
      contactPhone: "+380501234567",
      phoneCountry: "UA",
      primaryDomain: "acme.example.com",
    });
    await accept(UpdateTenantDto, { status: "team" });
    await accept(UpdateTenantDto, { name: "Acme Ltd" });
    await accept(UpdateTenantDto, { contactPhone: "+380501234567" });
    await accept(UpdateTenantDto, { productsEnabled: true });
    await accept(UpdateTenantDto, { adminLimit: 3 });
    await accept(UpdateTenantDto, { adminLimit: null });
    await accept(RequestTenantPurgeDto, {
      confirmSlug: "acme",
      mfaCode: "123456",
    });
    await accept(InviteTenantSuperadminDto, { email: "boss@example.com" });
    await accept(PromoteTenantSuperadminDto, { userId: "user-1" });
  });

  it("refuses an explicit null where the service would have thrown a TypeError", async () => {
    // These fields are read as strings (`input.name.trim()`), so `null` was a
    // 500 rather than a "clear this field" — the one place this tier departs
    // from the track's @IsOptional() idiom.
    await reject(UpdateTenantDto, { name: null }, "name");
    await reject(UpdateTenantDto, { country: null }, "country");
    await reject(CreateTenantDto, { contactName: null }, "contactName");
  });

  it("keeps null meaningful on the two fields where it clears something", async () => {
    await accept(UpdateTenantDto, { primaryDomain: null });
    await accept(UpdateTenantDto, { adminLimit: null });
  });

  it("gates the segment template, the one enum this tier moves forward", async () => {
    // The service's refusal does not name the allowed values, and the template
    // is fixed at creation — a wrong one is not recoverable by a later edit.
    await reject(
      CreateTenantDto,
      { segmentTemplate: "distributon" },
      "segmentTemplate",
    );
  });

  it("leaves the tenant status a free string, because the service explains itself", async () => {
    // "Use the archive action to archive a tenant; draft, provisioning, ready
    // and active cannot be assigned…" — more than @IsIn could say, and an
    // unassignable status is refused rather than written past.
    await accept(UpdateTenantDto, { status: "archived" });
    await accept(UpdateTenantDto, { status: "nonsense" });
  });

  it("refuses the slug and segment template on an update, which it silently ignored", async () => {
    // UpdateTenantDto deliberately does not extend CreateTenantDto: a slug the
    // caller believed they had changed is the worst kind of 200.
    await reject(UpdateTenantDto, { slug: "renamed" }, "slug");
    await reject(
      UpdateTenantDto,
      { segmentTemplate: "distribution" },
      "segmentTemplate",
    );
  });

  it("leaves the length caps to the service, which reports them per field", async () => {
    // createTenant/updateTenant answer "Keep this to 120 characters or fewer."
    // against the same TEXT_LIMITS table, aggregating every failing field into
    // one response.
    await accept(CreateTenantDto, { name: "a".repeat(500) });
    await accept(UpdateTenantDto, { contactName: "a".repeat(500) });
  });

  it("does not type-check the purge MFA code, so every refusal is still audited", async () => {
    // A pipe runs before the service, and platform.service.ts is what
    // penalizes the shared platform-login backoff and records
    // recordPlatformReauthFailed. @IsString() here would turn the obvious
    // scripted shape into an unlogged, unpenalized 400.
    await accept(RequestTenantPurgeDto, { mfaCode: 123_456 });
    await accept(RequestTenantPurgeDto, { mfaCode: null });
    await accept(RequestTenantPurgeDto, { mfaCode: { code: "123456" } });
  });

  it("still refuses a confirmSlug that could not name a tenant", async () => {
    await reject(
      RequestTenantPurgeDto,
      { confirmSlug: "a".repeat(65) },
      "confirmSlug",
    );
    // A wrong-but-plausible slug stays the service's own
    // TENANT_PURGE_CONFIRMATION_MISMATCH.
    await accept(RequestTenantPurgeDto, { confirmSlug: "some-other-tenant" });
  });
});
