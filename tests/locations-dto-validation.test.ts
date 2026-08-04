import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { TEXT_LIMITS } from "../src/common/input-limits";
import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { LocationsController } from "../src/modules/locations/locations.controller";
import {
  CreateLocationAssignmentDto,
  CreateLocationDto,
  UpdateLocationDto,
  UpdateLocationNotesDto,
  UpsertLocationContactDto,
} from "../src/modules/locations/locations.dto";

// The last module of the flat-CRUD tier on the class-validator DTO track (2.4
// in docs/security-remediation-plan.md): six write routes across three
// resources, five DTO classes, each route gated by its own @UsePipes rather
// than a global pipe.
//
// As in tests/flat-crud-dto-validation.test.ts, the transform cases run the
// real ValidationPipe with the metadata Nest attaches to a @Body() parameter,
// and a separate case reads PIPES_METADATA off the handlers — otherwise every
// case here would keep passing against a route the pipe never reached.

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

      // The API's own envelope, not Nest's default { message: string[] }.
      assert.equal(response.code, "VALIDATION_FAILED");
      assert.ok(
        response.fieldErrors?.[field]?.length,
        `expected a field error on ${field}, got ${JSON.stringify(response.fieldErrors)}`,
      );

      return true;
    },
  );
}

describe("every locations write route with a body carries the pipe", () => {
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["createLocation", LocationsController.prototype.createLocation],
    ["updateLocation", LocationsController.prototype.updateLocation],
    ["updateLocationNotes", LocationsController.prototype.updateLocationNotes],
    ["createContact", LocationsController.prototype.createContact],
    ["updateContact", LocationsController.prototype.updateContact],
    ["createAssignment", LocationsController.prototype.createAssignment],
  ];

  // Every route on this controller that takes no @Body(): four reads and four
  // writes whose whole payload is in the path. A pipe on any of them would be
  // whitelist applied to a body no DTO describes.
  const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["listLocations", LocationsController.prototype.listLocations],
    ["getLocation", LocationsController.prototype.getLocation],
    ["archiveLocation", LocationsController.prototype.archiveLocation],
    ["restoreLocation", LocationsController.prototype.restoreLocation],
    ["listContacts", LocationsController.prototype.listContacts],
    ["deleteContact", LocationsController.prototype.deleteContact],
    ["listAssignments", LocationsController.prototype.listAssignments],
    [
      "deactivateAssignment",
      LocationsController.prototype.deactivateAssignment,
    ],
  ];

  it("attaches a pipe to all six body handlers, and to none of the other eight", () => {
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

describe("locations DTOs: what all five classes share", () => {
  const everyDto: DtoClass[] = [
    CreateLocationDto,
    UpdateLocationDto,
    UpdateLocationNotesDto,
    UpsertLocationContactDto,
    CreateLocationAssignmentDto,
  ];

  it("refuses an undeclared property on every route in the module", async () => {
    // Mass assignment is what the whitelist exists to stop. `tenantId` is the
    // load-bearing case: the services read it from the request context and
    // never from a body, and this makes that unreachable rather than merely
    // unread.
    for (const dto of everyDto) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }
  });

  it("lets an omitted field stay omitted, so the services keep owning required-ness", async () => {
    // "Location name, address line and city are required." is still
    // LOCATION_INVALID from locations.service.ts, not VALIDATION_FAILED here.
    const created = await accept(CreateLocationDto, {});

    assert.equal(created.name, undefined);
    assert.equal(created.city, undefined);

    const assignment = await accept(CreateLocationAssignmentDto, {});

    assert.equal(assignment.representativeUserId, undefined);
  });

  it("passes an explicit null through, which is how a caller clears a field", async () => {
    // @IsOptional() skips null as well as undefined. The normalizers behind
    // these routes read null as "clear it" — documented for chainId/categoryId
    // and for the note — and would never see it if the pipe rejected it first.
    await accept(UpdateLocationDto, {
      chainId: null,
      categoryId: null,
      notes: null,
    });
    await accept(UpdateLocationNotesDto, { notes: null });
    await accept(UpsertLocationContactDto, {
      roleTitle: null,
      phone: null,
      email: null,
      notes: null,
    });
  });
});

describe("CreateLocationDto / UpdateLocationDto", () => {
  it("accepts the body the admin console actually posts", async () => {
    // Both live payloads from apps/web/lib/api-client.ts
    // (createAdminLocation, updateAdminLocation). forbidNonWhitelisted turns
    // any field these send and the DTO forgets into a broken screen, so they
    // are pinned rather than sampled.
    const created = await accept(CreateLocationDto, {
      name: "Kyiv North Market",
      addressLine: "Vulytsia Test 1",
      city: "Kyiv",
      externalCode: "KN-01",
      categoryId: "category-a",
      chainId: "chain-a",
      notes: "Opens at seven.",
    });

    assert.equal(created.name, "Kyiv North Market");

    const updated = await accept(UpdateLocationDto, {
      name: "Kyiv North Market",
      externalCode: "KN-01",
      addressLine: "Vulytsia Test 1",
      city: "Kyiv",
      categoryId: "category-a",
      chainId: "chain-a",
      notes: "Opens at seven.",
      status: "inactive",
    });

    assert.equal(updated.status, "inactive");
  });

  it("accepts each free-text field at its cap and refuses it one character past", async () => {
    const caps = [
      ["name", 120],
      ["addressLine", 200],
      ["city", 120],
      ["externalCode", 64],
      ["notes", 2000],
    ] as const;

    for (const [field, cap] of caps) {
      const accepted = await accept(CreateLocationDto, {
        [field]: "x".repeat(cap),
      });

      assert.equal(
        (accepted as Record<string, string | undefined>)[field]?.length,
        cap,
      );

      // The cap moves earlier, which is the point: normalizeRequiredString
      // folded an over-length name into the same null as a missing one, so a
      // 121-character name came back as "Name is required."
      await reject(CreateLocationDto, { [field]: "x".repeat(cap + 1) }, field);
    }
  });

  it("refuses a non-string chain or category id, which used to clear the link", async () => {
    // The tightening: on PATCH the field is present, so normalizeId's null was
    // written rather than ignored — `{"chainId": 0}` unlinked the chain and
    // answered 200.
    await reject(UpdateLocationDto, { chainId: 0 }, "chainId");
    await reject(UpdateLocationDto, { categoryId: 12 }, "categoryId");
  });

  it("refuses `archived` and any unrecognised status, which used to be dropped", async () => {
    // Archiving is DELETE /locations/:id; `archived` is not a writable status
    // and never was. Both it and a typo used to be mapped to null and spread
    // away under a 200.
    await reject(UpdateLocationDto, { status: "archived" }, "status");
    await reject(UpdateLocationDto, { status: "actve" }, "status");

    for (const status of ["active", "inactive"]) {
      const accepted = await accept(UpdateLocationDto, { status });

      assert.equal(accepted.status, status);
    }
  });

  it("takes a coordinate as a number or as a numeric string, untouched either way", async () => {
    // normalizeCoordinate parseFloat()s a string, so narrowing this to numbers
    // would be a contract change. The string must also arrive unconverted —
    // the pipe transforms into the DTO class but does not coerce types, and
    // `Number("")` is 0 where normalizeCoordinate reads "" as "no coordinate".
    const fromNumbers = await accept(CreateLocationDto, {
      latitude: 50.45,
      longitude: 30.52,
    });

    assert.equal(fromNumbers.latitude, 50.45);

    const fromStrings = await accept(CreateLocationDto, {
      latitude: "50.45",
      longitude: "",
    });

    assert.equal(fromStrings.latitude, "50.45");
    assert.equal(fromStrings.longitude, "");
  });

  it("refuses a coordinate that is neither, one layer before the service would", async () => {
    await reject(CreateLocationDto, { latitude: { lat: 50 } }, "latitude");
    await reject(CreateLocationDto, { longitude: [30.52] }, "longitude");
  });
});

describe("UpdateLocationNotesDto", () => {
  it("keeps all three ways of clearing a note working", async () => {
    // Omitted, null and blank all mean "clear it" (api-reference.md), and all
    // three have to reach normalizeNotesInput to mean anything.
    for (const body of [{}, { notes: null }, { notes: "" }]) {
      await accept(UpdateLocationNotesDto, body);
    }
  });

  it("refuses a non-string note and one over the 2000-character cap", async () => {
    // Both were already refused by normalizeNotesInput with
    // LOCATION_NOTES_INVALID; the DTO only moves the verdict earlier.
    await reject(UpdateLocationNotesDto, { notes: 42 }, "notes");
    await reject(UpdateLocationNotesDto, { notes: "x".repeat(2001) }, "notes");

    const accepted = await accept(UpdateLocationNotesDto, {
      notes: "x".repeat(2000),
    });

    assert.equal(accepted.notes?.length, 2000);
  });
});

describe("UpsertLocationContactDto", () => {
  it("accepts both contact payloads apps/web posts", async () => {
    // The field zone sends the full field set; the admin console's two fixed
    // slots send name+phone only.
    const full = await accept(UpsertLocationContactDto, {
      name: "Olena K.",
      roleTitle: "Store manager",
      phone: "+380441234567",
      email: "olena@example.com",
      notes: "Prefers morning calls.",
    });

    assert.equal(full.name, "Olena K.");

    await accept(UpsertLocationContactDto, {
      name: "Olena K.",
      phone: null,
    });
  });

  it("caps name, roleTitle, email and notes", async () => {
    const caps = [
      ["name", 120],
      ["roleTitle", 200],
      ["email", 254],
      ["notes", 2000],
    ] as const;

    for (const [field, cap] of caps) {
      await accept(UpsertLocationContactDto, { [field]: "x".repeat(cap) });
      await reject(
        UpsertLocationContactDto,
        { [field]: "x".repeat(cap + 1) },
        field,
      );
    }
  });

  it("puts no length cap on phone, so an unchanged legacy value still passes", async () => {
    // Deliberate, and the one field in this module with no cap: nothing behind
    // it caps a phone either, and parseUpdateContactBody passes an unchanged
    // phone through unvalidated precisely so a pre-normalization value doesn't
    // block an unrelated edit. A cap here would be the one thing that could
    // reject it.
    const legacyPhone = "+38 (044) 123-45-67, dobavochnyi 123";

    assert.ok(
      legacyPhone.length > TEXT_LIMITS.phone,
      "the fixture has to be past the cap this DTO declines to declare",
    );

    const accepted = await accept(UpsertLocationContactDto, {
      phone: legacyPhone,
    });

    assert.equal(accepted.phone, legacyPhone);
  });

  it("refuses a non-string email, which used to read as clearing it", async () => {
    // normalizeOptionalString returns null for a non-string, so on update
    // `{"email": 42}` erased the contact's email under a 200.
    await reject(UpsertLocationContactDto, { email: 42 }, "email");
    await reject(UpsertLocationContactDto, { name: 42 }, "name");
  });
});

describe("CreateLocationAssignmentDto", () => {
  it("passes a representative id through and refuses a non-string one", async () => {
    const accepted = await accept(CreateLocationAssignmentDto, {
      representativeUserId: "user-a",
    });

    assert.equal(accepted.representativeUserId, "user-a");

    await reject(
      CreateLocationAssignmentDto,
      { representativeUserId: ["user-a"] },
      "representativeUserId",
    );
  });
});
