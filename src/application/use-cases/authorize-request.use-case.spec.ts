import {
  ForbiddenRouteError,
  MissingOrInvalidTokenError,
  RouteNotFoundError,
} from "@domain/errors/gateway.errors";
import type { Principal, TokenVerifier } from "@application/ports/token-verifier.port";
import { AuthorizeRequestUseCase } from "./authorize-request.use-case";

const OPERATOR: Principal = { userId: "u-1", roles: ["operator"] };

class FakeVerifier implements TokenVerifier {
  readonly seen: string[] = [];
  async verify(token: string): Promise<Principal | undefined> {
    this.seen.push(token);
    return token === "valido" ? OPERATOR : undefined;
  }
}

describe("AuthorizeRequestUseCase", () => {
  let verifier: FakeVerifier;
  let authorize: AuthorizeRequestUseCase;

  beforeEach(() => {
    verifier = new FakeVerifier();
    authorize = new AuthorizeRequestUseCase(verifier);
  });

  it("rota inexistente: RouteNotFoundError, sem validar token", async () => {
    await expect(
      authorize.execute({ method: "GET", url: "/api/v1/nada", authorization: "Bearer valido" }),
    ).rejects.toBeInstanceOf(RouteNotFoundError);
    expect(verifier.seen).toEqual([]);
  });

  it("rota publica sem token segue sem principal", async () => {
    const result = await authorize.execute({ method: "POST", url: "/api/v1/auth/login", authorization: undefined });

    expect(result.principal).toBeUndefined();
    expect(result.target.route.upstream).toBe("auth");
  });

  it.each([undefined, "Bearer invalido", "Basic abc", "Bearer", "Bearer a b"])(
    "rota protegida com authorization %p: 401",
    async (authorization) => {
      await expect(
        authorize.execute({ method: "GET", url: "/api/v1/items", authorization }),
      ).rejects.toBeInstanceOf(MissingOrInvalidTokenError);
    },
  );

  it("token invalido e 401 mesmo em rota publica", async () => {
    await expect(
      authorize.execute({ method: "POST", url: "/api/v1/auth/login", authorization: "Bearer invalido" }),
    ).rejects.toBeInstanceOf(MissingOrInvalidTokenError);
  });

  it("operator le e escreve em /items, mas nao cria usuario", async () => {
    const read = await authorize.execute({ method: "GET", url: "/api/v1/items", authorization: "Bearer valido" });
    const write = await authorize.execute({ method: "POST", url: "/api/v1/items", authorization: "bearer valido" });

    expect(read.principal).toEqual(OPERATOR);
    expect(write.principal).toEqual(OPERATOR);
    await expect(
      authorize.execute({ method: "POST", url: "/api/v1/users", authorization: "Bearer valido" }),
    ).rejects.toBeInstanceOf(ForbiddenRouteError);
  });
});
