import type { IncomingHttpHeaders } from "node:http";
import type { Principal } from "@application/ports/token-verifier.port";

export const USER_ID_HEADER = "x-user-id";
export const USER_ROLES_HEADER = "x-user-roles";

// Headers de identidade so podem vir do gateway: qualquer x-user-* enviado
// pelo cliente e removido antes de injetar os do token validado. O
// Authorization so segue para o ms-auth, que revalida o proprio token nas
// rotas de usuario (defesa em profundidade); os demais servicos confiam no
// gateway e nao recebem o token.
export function sanitizeForwardedHeaders(
  headers: IncomingHttpHeaders,
  principal: Principal | undefined,
  correlationId: string,
  keepAuthorization: boolean,
): void {
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-user-")) Reflect.deleteProperty(headers, name);
  }
  if (!keepAuthorization) Reflect.deleteProperty(headers, "authorization");
  headers["x-correlation-id"] = correlationId;
  if (principal) {
    headers[USER_ID_HEADER] = principal.userId;
    headers[USER_ROLES_HEADER] = principal.roles.join(",");
  }
}
