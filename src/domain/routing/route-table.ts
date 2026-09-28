// Tabela de rotas do gateway: prefixo publico -> servico interno + politica
// de acesso. Pura (sem Nest/HTTP): testavel e validada no boot.

export const UPSTREAMS = ["auth", "catalog", "transport", "customer", "salesOrder"] as const;
export type Upstream = (typeof UPSTREAMS)[number];

export const ROLES = ["admin", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const PUBLIC_PREFIX = "/api/v1";

// public: sem token. authenticated: qualquer token valido.
// roles: token valido com ao menos uma das roles.
export type AccessRule =
  | { readonly kind: "public" }
  | { readonly kind: "authenticated" }
  | { readonly kind: "roles"; readonly roles: readonly Role[] };

export interface RouteDefinition {
  // Prefixo apos /api/v1 (ex.: "/items"); casa o proprio prefixo e subpaths.
  readonly prefix: string;
  readonly upstream: Upstream;
  readonly read: AccessRule;
  readonly write: AccessRule;
}

const PUBLIC: AccessRule = { kind: "public" };
const AUTHENTICATED: AccessRule = { kind: "authenticated" };
const WRITERS: AccessRule = { kind: "roles", roles: ["admin", "operator"] };
const ADMINS: AccessRule = { kind: "roles", roles: ["admin"] };

export const ROUTES: readonly RouteDefinition[] = [
  { prefix: "/auth", upstream: "auth", read: PUBLIC, write: PUBLIC },
  { prefix: "/.well-known", upstream: "auth", read: PUBLIC, write: PUBLIC },
  // O ms-auth tambem valida o token e a role admin (defesa em profundidade).
  { prefix: "/users", upstream: "auth", read: AUTHENTICATED, write: ADMINS },
  { prefix: "/items", upstream: "catalog", read: AUTHENTICATED, write: WRITERS },
  { prefix: "/transport-types", upstream: "transport", read: AUTHENTICATED, write: WRITERS },
  { prefix: "/catalog-items", upstream: "transport", read: AUTHENTICATED, write: WRITERS },
  { prefix: "/customers", upstream: "customer", read: AUTHENTICATED, write: WRITERS },
  { prefix: "/sales-orders", upstream: "salesOrder", read: AUTHENTICATED, write: WRITERS },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ResolvedRoute {
  readonly route: RouteDefinition;
  readonly rule: AccessRule;
  // Path repassado ao servico: sem o prefixo /api/v1, com a query intacta.
  readonly upstreamPath: string;
}

// url = path + query da requisicao publica. undefined = rota inexistente.
export function resolveRoute(
  method: string,
  url: string,
  routes: readonly RouteDefinition[] = ROUTES,
): ResolvedRoute | undefined {
  const queryIndex = url.indexOf("?");
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : url.slice(queryIndex);
  if (!path.startsWith(`${PUBLIC_PREFIX}/`)) return undefined;

  const internalPath = path.slice(PUBLIC_PREFIX.length);
  // Path traversal ou barras duplicadas nunca chegam aos servicos.
  if (internalPath.includes("..") || internalPath.includes("//")) return undefined;

  const route = routes.find(
    (candidate) =>
      internalPath === candidate.prefix || internalPath.startsWith(`${candidate.prefix}/`),
  );
  if (!route) return undefined;

  const rule = READ_METHODS.has(method.toUpperCase()) ? route.read : route.write;
  return { route, rule, upstreamPath: `${internalPath}${query}` };
}

export type AccessDecision = "allow" | "unauthenticated" | "forbidden";

export function decideAccess(rule: AccessRule, roles: readonly Role[] | undefined): AccessDecision {
  if (rule.kind === "public") return "allow";
  if (roles === undefined) return "unauthenticated";
  if (rule.kind === "authenticated") return "allow";
  return rule.roles.some((role) => roles.includes(role)) ? "allow" : "forbidden";
}
