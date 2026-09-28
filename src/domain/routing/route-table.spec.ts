import { decideAccess, resolveRoute } from "./route-table";

describe("resolveRoute", () => {
  it.each([
    ["GET", "/api/v1/items", "catalog", "/items"],
    ["GET", "/api/v1/items/abc?x=1&y=2", "catalog", "/items/abc?x=1&y=2"],
    ["POST", "/api/v1/auth/login", "auth", "/auth/login"],
    ["GET", "/api/v1/.well-known/jwks.json", "auth", "/.well-known/jwks.json"],
    ["PUT", "/api/v1/transport-types/1", "transport", "/transport-types/1"],
    ["GET", "/api/v1/catalog-items/1", "transport", "/catalog-items/1"],
    ["GET", "/api/v1/customers", "customer", "/customers"],
    ["POST", "/api/v1/sales-orders/1/schedule", "salesOrder", "/sales-orders/1/schedule"],
  ])("%s %s -> %s %s", (method, url, upstream, upstreamPath) => {
    expect(resolveRoute(method, url)).toMatchObject({ route: { upstream }, upstreamPath });
  });

  it.each([
    "/items",
    "/api/v2/items",
    "/api/v1/itemsx",
    "/api/v1/unknown",
    "/api/v1/items/../users",
    "/api/v1//items",
  ])("nao resolve %s", (url) => {
    expect(resolveRoute("GET", url)).toBeUndefined();
  });

  it("leitura e escrita usam regras diferentes", () => {
    expect(resolveRoute("GET", "/api/v1/items")?.rule).toEqual({ kind: "authenticated" });
    expect(resolveRoute("POST", "/api/v1/items")?.rule).toEqual({
      kind: "roles",
      roles: ["admin", "operator"],
    });
    expect(resolveRoute("POST", "/api/v1/users")?.rule).toEqual({ kind: "roles", roles: ["admin"] });
  });
});

describe("decideAccess", () => {
  it("rota publica libera sem token", () => {
    expect(decideAccess({ kind: "public" }, undefined)).toBe("allow");
  });

  it("rota autenticada exige token", () => {
    expect(decideAccess({ kind: "authenticated" }, undefined)).toBe("unauthenticated");
    expect(decideAccess({ kind: "authenticated" }, ["operator"])).toBe("allow");
  });

  it("rota por role exige ao menos uma das roles", () => {
    const admins = { kind: "roles", roles: ["admin"] } as const;
    expect(decideAccess(admins, undefined)).toBe("unauthenticated");
    expect(decideAccess(admins, ["operator"])).toBe("forbidden");
    expect(decideAccess(admins, ["operator", "admin"])).toBe("allow");
  });
});
