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
    const readiness = await this.healthService.getReadiness();

    if (readiness.status !== "ready") {
      response.status(503);
    }

    return {
      ...readiness,
      requestId: request.requestId,
    };
  }
}
