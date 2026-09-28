import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { TOKEN_VERIFIER, type TokenVerifier } from "@application/ports/token-verifier.port";
import { AuthorizeRequestUseCase } from "@application/use-cases/authorize-request.use-case";
import { JwksTokenVerifier } from "@infrastructure/auth/jwks-token-verifier";
import { HealthController } from "@infrastructure/health/health.controller";
import { JwksHealthIndicator } from "@infrastructure/health/jwks.health";
import { GatewayController } from "@infrastructure/http/gateway.controller";
import { UpstreamProxyService } from "@infrastructure/proxy/upstream-proxy.service";

@Module({
  imports: [TerminusModule],
  // HealthController (e o MetricsController, no MetricsModule) ficam fora do
  // curinga: o gateway so trata /api/v1/*.
  controllers: [HealthController, GatewayController],
  providers: [
    { provide: TOKEN_VERIFIER, useClass: JwksTokenVerifier },
    {
      provide: AuthorizeRequestUseCase,
      useFactory: (tokens: TokenVerifier) => new AuthorizeRequestUseCase(tokens),
      inject: [TOKEN_VERIFIER],
    },
    UpstreamProxyService,
    JwksHealthIndicator,
  ],
})
export class GatewayModule {}
