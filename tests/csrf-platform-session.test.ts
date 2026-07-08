import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";

import { applyCsrfProtection, createCsrfToken } from "../src/modules/auth/csrf";

describe("csrf platform session selection", () => {
  it("validates platform mutations against the platform CSRF cookie when both sessions exist", () => {
    const platformCsrfToken = createCsrfToken("platform-token");
    const tenantCsrfToken = createCsrfToken("tenant-token");
    const request = createRequest({
      originalUrl: "/api/platform/tenants",
      platformSessionToken: "platform-token",
      sessionToken: "tenant-token",
      platformCsrfToken,
      tenantCsrfToken,
      headerToken: platformCsrfToken,
    });
    let nextCalled = false;

    applyCsrfProtection(request, {} as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it("does not let a tenant login's CSRF cookie satisfy a platform mutation", () => {
    // Regression test: vizitum_csrf used to be shared between the platform
    // and tenant auth flows, so logging into a tenant after a platform
    // session was already established would overwrite the one CSRF cookie
    // and permanently CSRF-lock the still-valid platform session out with
    // fully correct credentials. Namespaced cookies (vizitum_platform_csrf
    // vs vizitum_csrf) mean a tenant login can no longer touch the platform
    // session's CSRF cookie.
    const tenantCsrfToken = createCsrfToken("tenant-token");
    const request = createRequest({
      originalUrl: "/api/platform/tenants",
      platformSessionToken: "platform-token",
      sessionToken: "tenant-token",
      tenantCsrfToken,
      headerToken: tenantCsrfToken,
    });

    assert.throws(
      () => applyCsrfProtection(request, {} as Response, () => undefined),
      ForbiddenException,
    );
  });

  it("still rejects a platform mutation signed with the wrong session's key", () => {
    const wronglySignedToken = createCsrfToken("tenant-token");
    const request = createRequest({
      originalUrl: "/api/platform/tenants",
      platformSessionToken: "platform-token",
      sessionToken: "tenant-token",
      platformCsrfToken: wronglySignedToken,
      tenantCsrfToken: wronglySignedToken,
      headerToken: wronglySignedToken,
    });

    assert.throws(
      () => applyCsrfProtection(request, {} as Response, () => undefined),
      ForbiddenException,
    );
  });

  it("falls back to the tenant session and cookie on a platform path when no platform session exists", () => {
    const tenantCsrfToken = createCsrfToken("tenant-token");
    const request = createRequest({
      originalUrl: "/api/platform/tenants",
      sessionToken: "tenant-token",
      tenantCsrfToken,
      headerToken: tenantCsrfToken,
    });
    let nextCalled = false;

    applyCsrfProtection(request, {} as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it("falls back to the platform session and cookie on a tenant path when no tenant session exists", () => {
    const platformCsrfToken = createCsrfToken("platform-token");
    const request = createRequest({
      originalUrl: "/api/visits",
      platformSessionToken: "platform-token",
      platformCsrfToken,
      headerToken: platformCsrfToken,
    });
    let nextCalled = false;

    applyCsrfProtection(request, {} as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });
});

function createRequest(input: {
  originalUrl: string;
  platformSessionToken?: string;
  sessionToken?: string;
  platformCsrfToken?: string;
  tenantCsrfToken?: string;
  headerToken?: string;
}): Request {
  const cookieParts: string[] = [];

  if (input.sessionToken) {
    cookieParts.push(`vizitum_session=${input.sessionToken}`);
  }

  if (input.platformSessionToken) {
    cookieParts.push(`vizitum_platform_session=${input.platformSessionToken}`);
  }

  if (input.tenantCsrfToken) {
    cookieParts.push(`vizitum_csrf=${input.tenantCsrfToken}`);
  }

  if (input.platformCsrfToken) {
    cookieParts.push(`vizitum_platform_csrf=${input.platformCsrfToken}`);
  }

  const cookie = cookieParts.join("; ");

  return {
    header: (name: string) => {
      if (name.toLowerCase() === "cookie") {
        return cookie;
      }

      if (name.toLowerCase() === "x-csrf-token") {
        return input.headerToken;
      }

      return undefined;
    },
    method: "POST",
    originalUrl: input.originalUrl,
    url: input.originalUrl,
  } as Request;
}
