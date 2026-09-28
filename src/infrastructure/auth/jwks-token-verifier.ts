import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { ROLES } from "@domain/routing/route-table";
import type { Principal, TokenVerifier } from "@application/ports/token-verifier.port";
import { type Env, readEnv } from "@config/env";

const claimsSchema = z.object({
  sub: z.uuid(),
  roles: z.array(z.enum(ROLES)).min(1),
});

// Valida o JWT localmente com a chave publica do ms-auth. O JWKS e baixado
// sob demanda e cacheado; kid desconhecido dispara um refetch (rotacao de
// chave), com cooldown para nao martelar o ms-auth com tokens forjados.
@Injectable()
export class JwksTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService<Env, true>) {
    this.jwks = createRemoteJWKSet(new URL(readEnv(config, "AUTH_JWKS_URL")), {
      cacheMaxAge: readEnv(config, "JWKS_CACHE_MAX_AGE_MS"),
      cooldownDuration: 30_000,
      timeoutDuration: readEnv(config, "HEALTH_CHECK_TIMEOUT_MS"),
    });
    this.issuer = readEnv(config, "AUTH_ISSUER");
    this.audience = readEnv(config, "AUTH_AUDIENCE");
  }

  async verify(token: string): Promise<Principal | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ["RS256"],
        issuer: this.issuer,
        audience: this.audience,
      });
      const claims = claimsSchema.safeParse(payload);
      return claims.success ? { userId: claims.data.sub, roles: claims.data.roles } : undefined;
    } catch {
      return undefined;
    }
  }
}
