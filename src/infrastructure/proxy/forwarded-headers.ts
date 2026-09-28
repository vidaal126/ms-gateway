import type { IncomingHttpHeaders } from "node:http";
import type { Principal } from "@application/ports/token-verifier.port";

export const USER_ID_HEADER = "x-user-id";
export const USER_ROLES_HEADER = "x-user-roles";

// Headers de identidade so podem vir do gateway: qualquer x-user-* enviado
// pelo cliente e removido antes de injetar os do token validado. O
// Authorization tambem nao segue: os servicos confiam no gateway, nao no token.
export function sanitizeForwardedHeaders(
  headers: IncomingHttpHeaders,
  principal: Principal | undefined,
  correlationId: string,
): void {
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-user-")) Reflect.deleteProperty(headers, name);
  }
  Reflect.deleteProperty(headers, "authorization");
  headers["x-correlation-id"] = correlationId;
  if (principal) {
    headers[USER_ID_HEADER] = principal.userId;
    headers[USER_ROLES_HEADER] = principal.roles.join(",");
  }
}
