import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnnouncementsController } from "../src/modules/announcements/announcements.controller";
import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { ROLE_PERMISSION_MATRIX } from "../src/modules/roles/role-permission.matrix";

// The notice board is the one place a representative reads something a
// manager wrote, so the split between who publishes and who receives has to
// stay exactly where it is: a read permission that ever gained write reach
// would let the field edit the rules it is supposed to follow.
describe("announcements permissions", () => {
  it("requires announcements.manage on every publishing endpoint", () => {
    const writeHandlers = [
      AnnouncementsController.prototype.listAnnouncements,
      AnnouncementsController.prototype.createAnnouncement,
      AnnouncementsController.prototype.updateAnnouncement,
      AnnouncementsController.prototype.archiveAnnouncement,
    ];

    for (const handler of writeHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.ANNOUNCEMENTS_MANAGE],
        `${handler.name} must require announcements.manage`,
      );
      assert.equal(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
        undefined,
        `${handler.name} must not widen its guard to an any-of check`,
      );
    }
  });

  it("requires announcements.read on the field-facing endpoints", () => {
    const readHandlers = [
      AnnouncementsController.prototype.listActiveAnnouncements,
      AnnouncementsController.prototype.markAnnouncementRead,
    ];

    for (const handler of readHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.ANNOUNCEMENTS_READ],
        `${handler.name} must require announcements.read`,
      );
    }
  });

  it("keeps the field representative a reader and the manager an author", () => {
    assert.ok(
      ROLE_PERMISSION_MATRIX.field_representative.includes(
        PERMISSIONS.ANNOUNCEMENTS_READ,
      ),
    );
    assert.ok(
      !(
        ROLE_PERMISSION_MATRIX.field_representative as readonly string[]
      ).includes(PERMISSIONS.ANNOUNCEMENTS_MANAGE),
      "a representative must never be able to publish or withdraw an announcement",
    );
    assert.ok(
      ROLE_PERMISSION_MATRIX.team_manager.includes(
        PERMISSIONS.ANNOUNCEMENTS_MANAGE,
      ),
    );
  });

  // The board must stay reachable when the tenant is between managers: an
  // announcement that is wrong has to be withdrawable by someone.
  it("leaves the superadmin a repair path and the admin out of it", () => {
    assert.ok(
      ROLE_PERMISSION_MATRIX.tenant_superadmin.includes(
        PERMISSIONS.ANNOUNCEMENTS_MANAGE,
      ),
    );
    assert.ok(
      !(ROLE_PERMISSION_MATRIX.company_admin as readonly string[]).includes(
        PERMISSIONS.ANNOUNCEMENTS_MANAGE,
      ),
      "the admin zone does not author the notice board",
    );
  });
});
