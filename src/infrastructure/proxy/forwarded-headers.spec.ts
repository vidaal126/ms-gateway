import type { IncomingHttpHeaders } from "node:http";
import { sanitizeForwardedHeaders } from "./forwarded-headers";

describe("sanitizeForwardedHeaders", () => {
  it("remove x-user-* e authorization do cliente e injeta os do token", () => {
    const headers: IncomingHttpHeaders = {
      "x-user-id": "forjado",
      "x-user-roles": "admin",
      "x-user-anything": "x",
      authorization: "Bearer abc",
      "content-type": "application/json",
    };

    sanitizeForwardedHeaders(headers, { userId: "u-1", roles: ["admin", "operator"] }, "corr-1");

    expect(headers).toEqual({
      "content-type": "application/json",
      "x-correlation-id": "corr-1",
      "x-user-id": "u-1",
      "x-user-roles": "admin,operator",
    });
  });

  it("sem principal (rota publica) nao injeta identidade", () => {
    const headers: IncomingHttpHeaders = { "x-user-id": "forjado" };

    sanitizeForwardedHeaders(headers, undefined, "corr-2");

    expect(headers).toEqual({ "x-correlation-id": "corr-2" });
  });
});
