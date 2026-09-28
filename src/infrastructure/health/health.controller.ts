import { Controller, Get } from "@nestjs/common";
import { HealthCheck, type HealthCheckResult, HealthCheckService } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { JwksHealthIndicator } from "./jwks.health";

@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly jwks: JwksHealthIndicator,
  ) {}

  @Get("live")
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.jwks.isHealthy("jwks")]);
  }
}
