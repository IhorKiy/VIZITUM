import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { AnnouncementsController } from "../src/modules/announcements/announcements.controller";
import { UpsertAnnouncementDto } from "../src/modules/announcements/announcements.dto";
import { ChainsController } from "../src/modules/chains/chains.controller";
import {
  CreateChainDto,
  UpdateChainDto,
} from "../src/modules/chains/chains.dto";
import { LocationCategoriesController } from "../src/modules/locations/location-categories.controller";
import { UpsertLocationCategoryDto } from "../src/modules/locations/location-categories.dto";
import { ProductCategoriesController } from "../src/modules/products/product-categories.controller";
import { UpsertProductCategoryDto } from "../src/modules/products/product-categories.dto";
import { ProductsController } from "../src/modules/products/products.controller";
import {
  CreateProductDto,
  UpdateProductDto,
} from "../src/modules/products/products.dto";
import { TasksController } from "../src/modules/tasks/tasks.controller";
import { CreateTaskDto, UpdateTaskDto } from "../src/modules/tasks/tasks.dto";

// The flat-CRUD tier of the class-validator DTO track (2.4 in
// docs/security-remediation-plan.md): six controllers, twelve write routes,
// one property to pin across all of them — the scoped pipe accepts what these
// endpoints have always accepted and refuses a property no DTO declares.
//
// Asserting through the real ValidationPipe.transform() with the metadata Nest
// attaches to a `@Body()` parameter is what makes this a test of the
// controllers' @UsePipes(), rather than of the DTO classes in isolation.

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

describe("every write route in the tier actually carries the pipe", () => {
  // The DTO classes above are only a gate if @UsePipes reached the handler.
  // Decorator order is easy to get wrong and nothing else here would notice:
  // the transform tests build their own metadata, so they would keep passing
  // against a route the pipe was never attached to.
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["ChainsController.createChain", ChainsController.prototype.createChain],
    ["ChainsController.updateChain", ChainsController.prototype.updateChain],
    [
      "LocationCategoriesController.createCategory",
      LocationCategoriesController.prototype.createCategory,
    ],
    [
      "LocationCategoriesController.updateCategory",
      LocationCategoriesController.prototype.updateCategory,
    ],
    [
      "ProductCategoriesController.createCategory",
      ProductCategoriesController.prototype.createCategory,
    ],
    [
      "ProductCategoriesController.updateCategory",
      ProductCategoriesController.prototype.updateCategory,
    ],
    [
      "ProductsController.createProduct",
      ProductsController.prototype.createProduct,
    ],
    [
      "ProductsController.updateProduct",
      ProductsController.prototype.updateProduct,
    ],
    [
      "AnnouncementsController.createAnnouncement",
      AnnouncementsController.prototype.createAnnouncement,
    ],
    [
      "AnnouncementsController.updateAnnouncement",
      AnnouncementsController.prototype.updateAnnouncement,
    ],
    ["TasksController.createTask", TasksController.prototype.createTask],
    ["TasksController.updateTask", TasksController.prototype.updateTask],
  ];

  it("attaches a pipe to all twelve handlers, and to no read route", () => {
    for (const [name, handler] of gatedHandlers) {
      const pipes: unknown[] =
        Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

      assert.equal(pipes.length, 1, `${name} should carry exactly one pipe`);
    }

    // The counterpart: this is a per-route gate, not a controller-wide one.
    // A pipe on a list route would mean whitelist applied to a body no DTO
    // describes.
    assert.equal(
      Reflect.getMetadata(
        PIPES_METADATA,
        ChainsController.prototype.listChains,
      ),
      undefined,
    );
    assert.equal(
      Reflect.getMetadata(PIPES_METADATA, TasksController.prototype.listTasks),
      undefined,
    );
  });
});

describe("flat-CRUD DTOs: the property every one of them shares", () => {
  it("refuses an undeclared property on every route in the tier", async () => {
    // Mass assignment is what the whitelist exists to stop, so this runs
    // against all eight classes rather than a representative one.
    const everyDto: DtoClass[] = [
      CreateChainDto,
      UpdateChainDto,
      UpsertLocationCategoryDto,
      UpsertProductCategoryDto,
      CreateProductDto,
      UpdateProductDto,
      CreateTaskDto,
      UpdateTaskDto,
    ];

    for (const dto of everyDto) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }

    await reject(
      UpsertAnnouncementDto,
      { title: "Ok", tenantId: "another-tenant" },
      "tenantId",
    );
  });

  it("lets an omitted field stay omitted, so the services keep owning required-ness", async () => {
    // Every field is optional by design: "name is required" is still
    // CHAIN_INVALID from chains.service.ts, not VALIDATION_FAILED from here.
    const created = await accept(CreateChainDto, {});

    assert.equal(created.name, undefined);
  });

  it("passes an explicit null through, which is how a caller clears a field", async () => {
    // @IsOptional() skips null as well as undefined; the normalizers behind
    // these routes read null as "clear it" and would break if the pipe
    // rejected it first.
    await accept(UpdateChainDto, { notes: null });
    await accept(UpdateTaskDto, { assignedToUserId: null, dueDate: null });
  });
});

describe("UpsertLocationCategoryDto / UpsertProductCategoryDto", () => {
  it("accepts a name at the 120-character cap and refuses one past it", async () => {
    for (const dto of [UpsertLocationCategoryDto, UpsertProductCategoryDto]) {
      const accepted = await accept(dto, { name: "x".repeat(120) });

      assert.equal((accepted as { name?: string }).name?.length, 120);

      // Before this DTO, normalizeCategoryName folded an over-length name
      // into the same null as a missing one, so this came back as "Name is
      // required." — the cap now reports the actual problem.
      await reject(dto, { name: "x".repeat(121) }, "name");
    }
  });
});

describe("CreateChainDto / UpdateChainDto", () => {
  it("carries the parent class's fields onto the update DTO", async () => {
    // UpdateChainDto extends CreateChainDto; if class-validator did not
    // inherit that metadata, whitelist would strip `name` on every PATCH.
    const updated = await accept(UpdateChainDto, {
      name: "Acme Foods",
      externalCode: "AC-1",
      notes: "Head office moved.",
      status: "archived",
    });

    assert.equal(updated.name, "Acme Foods");
    assert.equal(updated.status, "archived");
  });

  it("refuses a status outside the two the service recognises", async () => {
    // Tightening: normalizeChainStatus mapped anything else to null and
    // parseUpdateChainBody spread it away, so this was a 200 that changed
    // nothing.
    await reject(UpdateChainDto, { status: "activ" }, "status");
  });

  it("applies each field's own cap rather than one shared number", async () => {
    // externalCode borrows the `code` cap (64), notes the `notes` one (2000).
    await reject(
      CreateChainDto,
      { externalCode: "x".repeat(65) },
      "externalCode",
    );
    await reject(CreateChainDto, { notes: "x".repeat(2001) }, "notes");
    await accept(CreateChainDto, { notes: "x".repeat(2000) });
  });
});

describe("CreateProductDto / UpdateProductDto", () => {
  it("accepts the full body the admin UI and the importer between them send", async () => {
    const created = await accept(CreateProductDto, {
      name: "Sparkling water 0.5L",
      externalCode: "EXT-9",
      sku: "SKU-9",
      category: "Beverages",
      notApplicable: false,
    });

    assert.equal(created.sku, "SKU-9");
    assert.equal(created.notApplicable, false);
  });

  it("refuses a non-boolean notApplicable", async () => {
    // Tightening: normalizeBoolean folded "true" to the fallback `false`,
    // giving the caller the opposite of what it asked for under a 200.
    await reject(CreateProductDto, { notApplicable: "true" }, "notApplicable");
  });

  it("refuses a status outside the three the service recognises", async () => {
    await reject(UpdateProductDto, { status: "deleted" }, "status");
    await accept(UpdateProductDto, { status: "inactive" });
  });
});

describe("UpsertAnnouncementDto", () => {
  it("accepts a full window and refuses a date that is not YYYY-MM-DD", async () => {
    const created = await accept(UpsertAnnouncementDto, {
      title: "Quarter close",
      body: "Submit outstanding reports by Friday.",
      startsAt: "2026-08-03",
      endsAt: "2026-08-14",
    });

    assert.equal(created.startsAt, "2026-08-03");

    await reject(UpsertAnnouncementDto, { startsAt: "03/08/2026" }, "startsAt");
    await reject(UpsertAnnouncementDto, { endsAt: "" }, "endsAt");
  });

  it("mirrors the title and body caps announcements.types.ts declares", async () => {
    await accept(UpsertAnnouncementDto, { title: "x".repeat(200) });
    await reject(UpsertAnnouncementDto, { title: "x".repeat(201) }, "title");
    await accept(UpsertAnnouncementDto, { body: "x".repeat(2000) });
    await reject(UpsertAnnouncementDto, { body: "x".repeat(2001) }, "body");
  });
});

describe("CreateTaskDto / UpdateTaskDto", () => {
  it("accepts the full create body, ids included", async () => {
    const created = await accept(CreateTaskDto, {
      title: "Check shelf share",
      description: "Compare against last visit.",
      isPriority: true,
      assignedToUserId: "usr_1",
      locationId: "loc_1",
      visitId: "vis_1",
      reportId: "rep_1",
      dueDate: "2026-08-10",
    });

    assert.equal(created.isPriority, true);
    assert.equal(created.dueDate, "2026-08-10");
  });

  it("keeps accepting an empty dueDate, which is how the field app clears one", async () => {
    // parseOptionalDateOnly reads "" as "no due date"; narrowing that to a
    // 400 would have turned clearing a due date into an error.
    const updated = await accept(UpdateTaskDto, { dueDate: "" });

    assert.equal(updated.dueDate, "");

    await reject(UpdateTaskDto, { dueDate: "10.08.2026" }, "dueDate");
  });

  it("refuses a status outside the two the service recognises", async () => {
    // The sharpest tightening in the tier: parseUpdateTaskBody read an
    // unrecognised status as "in_progress", so a typo reopened a done task.
    await reject(UpdateTaskDto, { status: "complete" }, "status");
    await accept(UpdateTaskDto, { status: "done" });
  });

  it("refuses a non-boolean isPriority", async () => {
    await reject(CreateTaskDto, { isPriority: "true" }, "isPriority");
  });

  it("caps title and description at the limits tasks.service.ts enforces", async () => {
    await accept(CreateTaskDto, { title: "x".repeat(200) });
    await reject(CreateTaskDto, { title: "x".repeat(201) }, "title");
    await reject(
      CreateTaskDto,
      { description: "x".repeat(2001) },
      "description",
    );
  });
});
