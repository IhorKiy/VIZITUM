import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

export type HealthStatus = {
  status: "ok";
  timestamp: string;
  database: "ok";
};

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthStatus> {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "ok",
    };
  }
}
