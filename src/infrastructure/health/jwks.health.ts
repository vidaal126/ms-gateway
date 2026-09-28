import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type HealthIndicatorResult, HealthIndicatorService } from "@nestjs/terminus";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import { type Env, readEnv } from "@config/env";

// Readiness do gateway depende so do JWKS (sem ele nenhuma rota protegida
// funciona). Servicos internos fora do ar viram 502 na rota, sem derrubar o
// gateway inteiro (evita falha em cascata).
@Injectable()
export class JwksHealthIndicator {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
    config: ConfigService<Env, true>,
  ) {
    this.url = readEnv(config, "AUTH_JWKS_URL");
    this.timeoutMs = readEnv(config, "HEALTH_CHECK_TIMEOUT_MS");
  }

  async isHealthy<const K extends string>(key: K): Promise<HealthIndicatorResult<K>> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return indicator.up();
    } catch (err) {
      this.logger.warn("JWKS indisponivel no health check", {
        error: err instanceof Error ? err.message : String(err),
      });
      return indicator.down({ message: "indisponivel" });
    }
  }
}
