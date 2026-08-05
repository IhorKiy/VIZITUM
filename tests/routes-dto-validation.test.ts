import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { RouteTemplatesController } from "../src/modules/routes/route-templates.controller";
import {
  AssignRouteTemplateDto,
  CopyRoutePlansDto,
  CopyRouteWeekDto,
  CreateRouteTemplateDto,
  MoveRouteTemplateItemDto,
  ReorderRouteTemplateItemsDto,
  UpdateRouteTemplateDto,
  UpsertRouteTemplateItemDto,
} from "../src/modules/routes/route-templates.dto";
import { RoutesController } from "../src/modules/routes/routes.controller";
import {
  CreateRouteItemDto,
  CreateRoutePlanDto,
  ReorderRouteItemsDto,
  UpdateRouteItemDto,
  UpdateRoutePlanDto,
} from "../src/modules/routes/routes.dto";

// Tier 3 of the class-validator DTO track (2.4 in
// docs/security-remediation-plan.md), minus `visits` which goes on its own:
// two controllers, fourteen write routes, thirteen DTO classes. One file rather
// than two, because the two controllers are twins — the template's item list
// and the plan's item list take the same shapes.
//
// As in the earlier tiers' files, the transform cases run the real
// ValidationPipe with the metadata Nest attaches to a @Body() parameter, and a
// separate case reads PIPES_METADATA off the handlers.

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
  CreateRoutePlanDto,
  UpdateRoutePlanDto,
  CreateRouteItemDto,
  UpdateRouteItemDto,
  ReorderRouteItemsDto,
  CreateRouteTemplateDto,
  UpdateRouteTemplateDto,
  UpsertRouteTemplateItemDto,
  ReorderRouteTemplateItemsDto,
  MoveRouteTemplateItemDto,
  AssignRouteTemplateDto,
  CopyRoutePlansDto,
  CopyRouteWeekDto,
];

describe("every routes write route with a body carries the pipe", () => {
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["routes.createRoutePlan", RoutesController.prototype.createRoutePlan],
    ["routes.updateRoutePlan", RoutesController.prototype.updateRoutePlan],
    ["routes.createRouteItem", RoutesController.prototype.createRouteItem],
    ["routes.updateRouteItem", RoutesController.prototype.updateRouteItem],
    ["routes.reorderRouteItems", RoutesController.prototype.reorderRouteItems],
    [
      "templates.createRouteTemplate",
      RouteTemplatesController.prototype.createRouteTemplate,
    ],
    [
      "templates.copyRoutePlans",
      RouteTemplatesController.prototype.copyRoutePlans,
    ],
    [
      "templates.copyRouteWeek",
      RouteTemplatesController.prototype.copyRouteWeek,
    ],
    [
      "templates.updateRouteTemplate",
      RouteTemplatesController.prototype.updateRouteTemplate,
    ],
    [
      "templates.createRouteTemplateItem",
      RouteTemplatesController.prototype.createRouteTemplateItem,
    ],
    [
      "templates.updateRouteTemplateItem",
      RouteTemplatesController.prototype.updateRouteTemplateItem,
    ],
    [
      "templates.reorderRouteTemplateItems",
      RouteTemplatesController.prototype.reorderRouteTemplateItems,
    ],
    [
      "templates.moveRouteTemplateItem",
      RouteTemplatesController.prototype.moveRouteTemplateItem,
    ],
    [
      "templates.assignRouteTemplate",
      RouteTemplatesController.prototype.assignRouteTemplate,
    ],
  ];

  // Every route on either controller that takes no @Body(). A pipe here would
  // be whitelist applied to a body no DTO describes.
  const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["routes.getTodayRoutes", RoutesController.prototype.getTodayRoutes],
    ["routes.listRoutes", RoutesController.prototype.listRoutes],
    ["routes.deleteRoutePlan", RoutesController.prototype.deleteRoutePlan],
    ["routes.deleteRouteItem", RoutesController.prototype.deleteRouteItem],
    [
      "templates.listRouteTemplates",
      RouteTemplatesController.prototype.listRouteTemplates,
    ],
    [
      "templates.getRouteTemplate",
      RouteTemplatesController.prototype.getRouteTemplate,
    ],
    [
      "templates.deleteRouteTemplate",
      RouteTemplatesController.prototype.deleteRouteTemplate,
    ],
    [
      "templates.deleteRouteTemplateItem",
      RouteTemplatesController.prototype.deleteRouteTemplateItem,
    ],
  ];

  it("attaches a pipe to all fourteen body handlers, and to none of the other eight", () => {
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

describe("routes DTOs: what all thirteen classes share", () => {
  it("refuses an undeclared property on every route in the tier", async () => {
    for (const dto of EVERY_DTO) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }
  });

  it("lets an omitted field stay omitted, so the services keep owning required-ness", async () => {
    // "Representative user id and plan date are required." is still
    // ROUTE_PLAN_INVALID from routes.service.ts, not VALIDATION_FAILED here.
    for (const dto of EVERY_DTO) {
      await accept(dto, {});
    }
  });
});

describe("RoutesController's five bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    // From apps/web/lib/api-client.ts: createRoutePlan, addRouteItem,
    // updateRouteItem, reorderRouteItems. forbidNonWhitelisted turns a field
    // these send and a DTO forgets into a broken screen.
    const plan = await accept(CreateRoutePlanDto, {
      representativeUserId: "user-a",
      planDate: "2026-08-10",
    });

    assert.equal(plan.planDate, "2026-08-10");

    await accept(CreateRouteItemDto, { locationId: "location-a", sequence: 1 });
    await accept(UpdateRouteItemDto, { status: "visited", sequence: 2 });

    const reorder = await accept(ReorderRouteItemsDto, {
      itemIds: ["item-a", "item-b"],
    });

    assert.deepEqual(reorder.itemIds, ["item-a", "item-b"]);
  });

  it("refuses a plan status the service does not recognise, which used to be dropped", async () => {
    for (const status of [
      "draft",
      "published",
      "in_progress",
      "completed",
      "cancelled",
    ]) {
      await accept(UpdateRoutePlanDto, { status });
    }

    await reject(UpdateRoutePlanDto, { status: "publised" }, "status");
    await reject(UpdateRoutePlanDto, { status: "archived" }, "status");
  });

  it("keeps publishedAt loose, since parseOptionalDateTime defines that contract", async () => {
    // "" and null are both how a caller clears the timestamp, and the service
    // reads anything `new Date()` can parse — so no ISO pattern here.
    for (const publishedAt of ["2026-08-10T09:00:00.000Z", "", null]) {
      await accept(UpdateRoutePlanDto, { publishedAt });
    }

    await reject(
      UpdateRoutePlanDto,
      { publishedAt: 1754000000 },
      "publishedAt",
    );
  });

  it("refuses an item status outside the three, and a non-integer sequence", async () => {
    for (const status of ["planned", "visited", "skipped"]) {
      await accept(UpdateRouteItemDto, { status });
    }

    await reject(UpdateRouteItemDto, { status: "done" }, "status");

    // The silent case: normalizePositiveInteger nulls a non-integer and the
    // update spreads it away, so `{"sequence": "3"}` renumbered nothing and
    // answered 200.
    await reject(UpdateRouteItemDto, { sequence: "3" }, "sequence");
    await reject(UpdateRouteItemDto, { sequence: 1.5 }, "sequence");
    await reject(UpdateRouteItemDto, { sequence: 0 }, "sequence");
  });

  it("caps skipReason at 200, the same key the service reads", async () => {
    const accepted = await accept(UpdateRouteItemDto, {
      skipReason: "x".repeat(200),
    });

    assert.equal(accepted.skipReason?.length, 200);

    await reject(
      UpdateRouteItemDto,
      { skipReason: "x".repeat(201) },
      "skipReason",
    );
    // A non-string used to mean "clear the skip reason", since the field is
    // present on a PATCH.
    await reject(UpdateRouteItemDto, { skipReason: 42 }, "skipReason");
  });

  it("takes itemIds as a list of strings and nothing else", async () => {
    // The tier was scheduled as the first to need @ValidateNested; the only
    // array on either controller turns out to hold ids, not objects.
    await reject(ReorderRouteItemsDto, { itemIds: "item-a" }, "itemIds");
    await reject(ReorderRouteItemsDto, { itemIds: [1, 2] }, "itemIds");
    await reject(ReorderRouteItemsDto, { itemIds: [{ id: "a" }] }, "itemIds");

    // An empty list is the service's own ROUTE_ITEM_REORDER_INVALID, not a
    // whitelist rejection: it is a permutation question, not a shape one.
    await accept(ReorderRouteItemsDto, { itemIds: [] });
  });

  it("checks the planDate shape and leaves calendar validity to parseDateOnly", async () => {
    await reject(CreateRoutePlanDto, { planDate: "10/08/2026" }, "planDate");
    // Pattern-valid, calendar-invalid: the DTO lets it through on purpose,
    // and parseDateOnly answers ROUTE_PLAN_INVALID behind it — which it only
    // actually did once tests/route-date-rollover.test.ts's fix landed. Until
    // then this date created a plan on March 3rd under a 201.
    await accept(CreateRoutePlanDto, { planDate: "2026-02-31" });
  });
});

describe("RouteTemplatesController's nine bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    await accept(CreateRouteTemplateDto, {
      representativeUserId: "user-a",
      name: "Monday north",
    });
    await accept(UpdateRouteTemplateDto, { name: "Monday north" });
    await accept(UpsertRouteTemplateItemDto, {
      locationId: "location-a",
      sequence: 1,
    });
    await accept(UpsertRouteTemplateItemDto, { sequence: 2 });
    await accept(ReorderRouteTemplateItemsDto, { itemIds: ["item-a"] });
    await accept(AssignRouteTemplateDto, { planDate: "2026-08-10" });
    await accept(CopyRoutePlansDto, { month: "2026-08" });
    await accept(CopyRouteWeekDto, {
      fromWeekStart: "2026-08-03",
      toWeekStart: "2026-08-10",
    });
  });

  it("reports an over-length template name as over-length, on both routes", async () => {
    // normalizeTemplateName folds it into the same null as a blank name, so
    // the answer used to be "Representative user id and name are required."
    for (const dto of [CreateRouteTemplateDto, UpdateRouteTemplateDto]) {
      const accepted = await accept(dto, { name: "x".repeat(120) });

      assert.equal((accepted as { name?: string }).name?.length, 120);

      await reject(dto, { name: "x".repeat(121) }, "name");
    }
  });

  it("does not let a rename reassign the template", async () => {
    // UpdateRouteTemplateDto deliberately does not extend the create class:
    // updateRouteTemplate ignores a representative, and inheriting the field
    // would have whitelisted a value the route silently drops.
    await reject(
      UpdateRouteTemplateDto,
      { name: "Monday north", representativeUserId: "user-b" },
      "representativeUserId",
    );
  });

  it("refuses a direction outside up/down", async () => {
    for (const direction of ["up", "down"]) {
      await accept(MoveRouteTemplateItemDto, { direction });
    }

    await reject(MoveRouteTemplateItemDto, { direction: "left" }, "direction");
    await reject(MoveRouteTemplateItemDto, { direction: 1 }, "direction");
  });

  it("checks the month shape and leaves the 1-12 range to normalizeMonth", async () => {
    await reject(CopyRoutePlansDto, { month: "2026-8" }, "month");
    await reject(CopyRoutePlansDto, { month: "August 2026" }, "month");
    // Pattern-valid, month-invalid: normalizeMonth still answers
    // ROUTE_COPY_MONTH_INVALID for this one.
    await accept(CopyRoutePlansDto, { month: "2026-13" });
  });

  it("checks both week-start shapes and leaves the is-it-a-Monday question to the service", async () => {
    for (const field of ["fromWeekStart", "toWeekStart"]) {
      await reject(CopyRouteWeekDto, { [field]: "2026-8-3" }, field);
      await reject(CopyRouteWeekDto, { [field]: "03/08/2026" }, field);
    }

    // Both pattern-valid: a Tuesday and a calendar-invalid day alike stay
    // parseWeekStart's ROUTE_COPY_WEEK_INVALID rather than becoming a
    // VALIDATION_FAILED here.
    await accept(CopyRouteWeekDto, {
      fromWeekStart: "2026-08-04",
      toWeekStart: "2026-02-31",
    });
  });
});
