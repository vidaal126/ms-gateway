import type { ConfigService } from "@nestjs/config";
import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();
const httpUrl = z.url({ protocol: /^https?$/ });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8088),
    // Porta interna do scrape do Prometheus (nao publicar). 0 = porta livre
    // escolhida pelo SO (testes).
    METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    // Servicos internos (sem barra final).
    UPSTREAM_AUTH_URL: httpUrl,
    UPSTREAM_CATALOG_URL: httpUrl,
    UPSTREAM_TRANSPORT_URL: httpUrl,
    UPSTREAM_CUSTOMER_URL: httpUrl,
    UPSTREAM_SALES_ORDER_URL: httpUrl,

    // Validacao de JWT: JWKS do ms-auth (cacheado) e claims esperadas.
    AUTH_JWKS_URL: httpUrl,
    AUTH_ISSUER: z.string().min(1).default("ms-auth"),
    AUTH_AUDIENCE: z.string().min(1).default("ms-platform"),
    JWKS_CACHE_MAX_AGE_MS: positiveInt.default(600_000),

    UPSTREAM_TIMEOUT_MS: positiveInt.default(10_000),
    MAX_BODY_BYTES: positiveInt.default(1_048_576),

    THROTTLE_DEFAULT_TTL_MS: positiveInt.default(60_000),
    THROTTLE_DEFAULT_LIMIT: positiveInt.default(300),

    HEALTH_CHECK_TIMEOUT_MS: positiveInt.default(1_500),
    SHUTDOWN_TIMEOUT_MS: positiveInt.default(10_000),
  })
  .refine((env) => env.METRICS_PORT !== env.PORT, {
    path: ["METRICS_PORT"],
    message: "METRICS_PORT deve ser diferente de PORT",
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      `Variaveis de ambiente invalidas:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export function readEnv<K extends keyof Env>(config: ConfigService<Env, true>, key: K): Env[K] {
  return config.get(key, { infer: true });
}
