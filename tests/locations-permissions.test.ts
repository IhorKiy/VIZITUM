import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { LocationsController } from "../src/modules/locations/locations.controller";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { ROLE_PERMISSION_MATRIX } from "../src/modules/roles/role-permission.matrix";

describe("locations controller permissions", () => {
  it("requires location_notes.manage or location_notes.manage_own to update the note", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_ANY_PERMISSIONS_METADATA,
        LocationsController.prototype.updateLocationNotes,
      ),
      [PERMISSIONS.LOCATION_NOTES_MANAGE, PERMISSIONS.LOCATION_NOTES_MANAGE_OWN],
    );
  });

  it("requires contacts.manage or contacts.manage_own on every contact write endpoint", () => {
    const writeHandlers = [
      LocationsController.prototype.createContact,
      LocationsController.prototype.updateContact,
      LocationsController.prototype.deleteContact,
    ];

    for (const handler of writeHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.CONTACTS_MANAGE, PERMISSIONS.CONTACTS_MANAGE_OWN],
        `${handler.name} must require contacts.manage or contacts.manage_own`,
      );
    }
  });

  // Regression guard: reading contacts must stay a plain, unscoped read —
  // the ownership tier only ever applies to writes.
  it("still requires only contacts.read to list contacts", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_METADATA,
        LocationsController.prototype.listContacts,
      ),
      [PERMISSIONS.CONTACTS_READ],
    );
  });
});

describe("role permission matrix: location notes and contacts", () => {
  it("grants field_representative only the own-location manage tier", () => {
    const permissions = ROLE_PERMISSION_MATRIX.field_representative;

    assert.ok(permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE_OWN));
    assert.ok(permissions.includes(PERMISSIONS.CONTACTS_MANAGE_OWN));
    assert.ok(!permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE));
    assert.ok(!permissions.includes(PERMISSIONS.CONTACTS_MANAGE));
  });

  it("grants company_admin and tenant_superadmin the full manage tier", () => {
    for (const role of ["company_admin", "tenant_superadmin"] as const) {
      const permissions = ROLE_PERMISSION_MATRIX[role];

      assert.ok(
        permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE),
        `${role} must hold location_notes.manage`,
      );
      assert.ok(
        permissions.includes(PERMISSIONS.CONTACTS_MANAGE),
        `${role} must hold contacts.manage`,
      );
      assert.ok(
        !permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE_OWN),
        `${role} should not need the own-location tier`,
      );
    }
  });

  it("grants team_manager neither manage tier", () => {
    const permissions = ROLE_PERMISSION_MATRIX.team_manager;

    assert.ok(!permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE));
    assert.ok(!permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE_OWN));
    assert.ok(!permissions.includes(PERMISSIONS.CONTACTS_MANAGE));
    assert.ok(!permissions.includes(PERMISSIONS.CONTACTS_MANAGE_OWN));
    assert.ok(permissions.includes(PERMISSIONS.CONTACTS_READ));
  });
});
