import {
  ForbiddenRouteError,
  MissingOrInvalidTokenError,
  RouteNotFoundError,
} from "@domain/errors/gateway.errors";
import { decideAccess, type ResolvedRoute, resolveRoute } from "@domain/routing/route-table";
import type { Principal, TokenVerifier } from "@application/ports/token-verifier.port";

export interface AuthorizeRequestInput {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
}

export interface AuthorizedRequest {
  readonly target: ResolvedRoute;
  // undefined em rota publica sem token.
  readonly principal: Principal | undefined;
}

// Decide se a requisicao segue para o servico: resolve a rota, valida o token
// (quando houver) e aplica a politica da rota.
export class AuthorizeRequestUseCase {
  constructor(private readonly tokens: TokenVerifier) {}

  async execute(input: AuthorizeRequestInput): Promise<AuthorizedRequest> {
    const target = resolveRoute(input.method, input.url);
    if (!target) throw new RouteNotFoundError();

    const bearer = bearerToken(input.authorization);
    // Token presente mas invalido e sempre 401, mesmo em rota publica: o
    // cliente acha que esta autenticado e nao esta.
    const principal = bearer === undefined ? undefined : await this.tokens.verify(bearer);
    if (bearer !== undefined && principal === undefined) throw new MissingOrInvalidTokenError();

    const decision = decideAccess(target.rule, principal?.roles);
    if (decision === "unauthenticated") throw new MissingOrInvalidTokenError();
    if (decision === "forbidden") throw new ForbiddenRouteError();
    return { target, principal };
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, token, extra] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra !== undefined) return "";
  return token;
}
