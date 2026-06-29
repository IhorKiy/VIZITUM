import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";

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
}
