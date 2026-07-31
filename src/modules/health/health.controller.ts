import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(@Req() request: Request) {
    const health = await this.healthService.getHealth();

    return {
      ...health,
      requestId: request.requestId,
    };
  }

  @Get("readiness")
  async getReadiness(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // `request.ip` is only meaningful once `trust proxy` has been applied, so
    // it is read here rather than derived in the service — this is the value
    // the rate limiter and the session `ipHash` will see for the same caller.
    const readiness = await this.healthService.getReadiness({
      clientAddress: request.ip,
      forwardedFor: request.header("x-forwarded-for"),
    });

    if (readiness.status !== "ready") {
      response.status(503);
    }

    return {
      ...readiness,
      requestId: request.requestId,
    };
  }
}
