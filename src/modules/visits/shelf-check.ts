import type { Prisma, PrismaClient } from "@prisma/client";

import { isRecord } from "./report-response.util";

export type ShelfCheck = {
  // Product ids the rep marked as absent. Everything else in the location's
  // matrix is what they implicitly confirmed as present.
  missingProductIds: string[];
  checkedAt: Date;
};

// The shelf check inside a confirmed visit report is the only thing that
// writes LocationAssortment's shelf state — the manager authors the matrix
// (`shouldBeListed`) and never touches `status`. Without this, coverage only
// ever moved when someone edited a row by hand, so the dashboard measured
// data entry rather than shelves.
//
// `shelfChecked` is required and deliberately not inferred from an empty
// `productUpdates`: "the rep looked and found no gaps" and "the rep never
// opened the shelf panel" are the same empty array, and guessing wrong marks
// a whole matrix in stock on the strength of a visit nobody audited.
export function extractShelfCheck(
  confirmedData: Prisma.InputJsonObject,
  fallbackDate: Date,
): ShelfCheck | null {
  // Everything below the top level is unvalidated JSON, so each step is
  // checked rather than cast — same shape as `problemPhotoObjectIdOf`.
  const fieldReport = isRecord(confirmedData)
    ? (confirmedData as Record<string, unknown>).fieldReport
    : undefined;

  if (!isRecord(fieldReport) || fieldReport.shelfChecked !== true) {
    return null;
  }

  const productUpdates = fieldReport.productUpdates;
  const missingProductIds = (
    Array.isArray(productUpdates) ? productUpdates : []
  ).flatMap((update: unknown): string[] =>
    isRecord(update) &&
    update.status === "out_of_stock" &&
    typeof update.productId === "string" &&
    update.productId.trim()
      ? [update.productId]
      : [],
  );

  return {
    missingProductIds,
    checkedAt: parseDateOnly(fieldReport.visitDate) ?? fallbackDate,
  };
}

// Writes what the rep saw onto the location's matrix rows, inside the caller's
// confirm transaction so a report and the coverage it implies can never
// disagree.
//
// Scope is the matrix as it stands at confirm time, read here rather than
// trusted from the report: a product the manager removed mid-visit is not
// resurrected, and one they added is picked up. Only required rows are
// touched — an off-matrix product the rep searched up has no row to speak
// for, and coverage ignores it either way. `shouldBeListed` is never written:
// the two owners of this row stay separate.
export async function applyShelfCheck(
  tx: Pick<PrismaClient, "locationAssortment">,
  tenantId: string,
  locationId: string,
  shelfCheck: ShelfCheck,
): Promise<void> {
  const requiredRows = await tx.locationAssortment.findMany({
    where: {
      tenantId,
      locationId,
      shouldBeListed: true,
      product: { deletedAt: null },
    },
    select: { productId: true },
  });

  if (requiredRows.length === 0) {
    return;
  }

  const missingProductIds = new Set(shelfCheck.missingProductIds);
  const missing: string[] = [];
  const present: string[] = [];

  for (const row of requiredRows) {
    (missingProductIds.has(row.productId) ? missing : present).push(
      row.productId,
    );
  }

  // Two grouped updates rather than a row-per-product loop: a full matrix can
  // run to hundreds of SKUs and this sits inside the confirm transaction.
  for (const [productIds, status] of [
    [present, "in_stock"],
    [missing, "out_of_stock"],
  ] as const) {
    if (productIds.length === 0) {
      continue;
    }

    await tx.locationAssortment.updateMany({
      where: {
        tenantId,
        locationId,
        productId: { in: productIds },
        // Never let an older observation overwrite a newer one. Reports are
        // confirmed whenever the rep gets to them, not in visit order: a
        // Monday visit confirmed after Wednesday's would otherwise reinstate
        // Monday's shelf and walk `lastCheckedAt` backwards. This also blunts
        // a back-dated `visitDate` from the form, which is client-supplied
        // and never checked against the visit's own dates.
        // `lte` rather than `lt` so re-confirming the same day's report still
        // applies — a same-day correction is the newest word on that shelf,
        // and a date column cannot resolve finer than that anyway.
        OR: [
          { lastCheckedAt: null },
          { lastCheckedAt: { lte: shelfCheck.checkedAt } },
        ],
      },
      data: { status, lastCheckedAt: shelfCheck.checkedAt },
    });
  }
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}
