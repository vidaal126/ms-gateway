import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { calculateJwkThumbprint, exportJWK, SignJWT } from "jose";
import { MetricsServer } from "../../src/infrastructure/metrics/metrics-server";
import { sampleValue } from "../../src/test/metrics.helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface FakeUpstream {
  readonly server: Server;
  readonly url: string;
  readonly requests: RecordedRequest[];
}

// Servico interno falso: registra o que o gateway encaminhou. /slow demora
// mais que o timeout do gateway.
async function startUpstream(name: string): Promise<FakeUpstream> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const reply = (): void => {
        res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ upstream: name, path: req.url }));
      };
      if (req.url?.includes("/slow")) setTimeout(reply, 1_500);
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, requests };
}

describe("ms-gateway: autenticacao, autorizacao e proxy (integracao)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let metricsUrl: string;
  let jwksServer: Server;
  let signingKey: KeyObject;
  let kid: string;
  const upstreams: Record<string, FakeUpstream> = {};

  const sign = async (
    roles: string[],
    overrides: { audience?: string; expiresIn?: string; key?: KeyObject } = {},
  ): Promise<string> =>
    new SignJWT({ roles })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(USER_ID)
      .setIssuer("ms-auth")
      .setAudience(overrides.audience ?? "ms-platform")
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(overrides.key ?? signingKey);

  const request = (
    method: string,
    path: string,
    options: { token?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${path}`, { method, headers, body: options.body });
  };

  beforeAll(async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    signingKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    kid = await calculateJwkThumbprint(jwk);
    jwksServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, resolve));
    const jwksPort = (jwksServer.address() as AddressInfo).port;

    for (const name of ["auth", "catalog", "transport", "salesOrder"]) {
      upstreams[name] = await startUpstream(name);
    }

    Object.assign(process.env, {
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      AUTH_JWKS_URL: `http://127.0.0.1:${jwksPort}/.well-known/jwks.json`,
      UPSTREAM_AUTH_URL: upstreams.auth?.url,
      UPSTREAM_CATALOG_URL: upstreams.catalog?.url,
      UPSTREAM_TRANSPORT_URL: upstreams.transport?.url,
      // Porta fechada: servico fora do ar.
      UPSTREAM_CUSTOMER_URL: "http://127.0.0.1:1",
      UPSTREAM_SALES_ORDER_URL: upstreams.salesOrder?.url,
      UPSTREAM_TIMEOUT_MS: "500",
      MAX_BODY_BYTES: "1024",
      METRICS_PORT: "0",
    });

    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../../src/app.module");
    const { configureApp, GATEWAY_APP_OPTIONS } = await import("../../src/app.setup");
    app = await NestFactory.create(AppModule, { ...GATEWAY_APP_OPTIONS, logger: false, abortOnError: false });
    configureApp(app);
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace("[::1]", "localhost");
    metricsUrl = `http://127.0.0.1:${app.get(MetricsServer).port}`;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all(
      [jwksServer, ...Object.values(upstreams).map((u) => u.server)].map(
        (server) => new Promise<void>((resolve) => server.close(() => { resolve(); })),
      ),
    );
  });

  it("rota protegida sem token: 401 sem chegar ao servico", async () => {
    const response = await request("GET", "/api/v1/items");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ statusCode: 401, error: "MissingOrInvalidTokenError" });
    expect(upstreams.catalog?.requests).toHaveLength(0);
  });

  it("encaminha com path reescrito, query, identidade do token e correlationId; remove o que o cliente forjou", async () => {
    const response = await request("GET", "/api/v1/items/abc?page=2", {
      token: await sign(["operator"]),
      headers: { "x-user-id": "forjado", "x-user-roles": "admin", "x-correlation-id": "gw-corr-1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("gw-corr-1");
    const forwarded = upstreams.catalog?.requests.at(-1);
    expect(forwarded?.url).toBe("/items/abc?page=2");
    expect(forwarded?.headers).toMatchObject({
      "x-user-id": USER_ID,
      "x-user-roles": "operator",
      "x-correlation-id": "gw-corr-1",
    });
    expect(forwarded?.headers.authorization).toBeUndefined();
  });

  it("POST: corpo segue em stream e status/corpo do servico voltam intactos", async () => {
    const body = JSON.stringify({ name: "Caminhao" });

    const response = await request("POST", "/api/v1/transport-types", { token: await sign(["admin"]), body });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ upstream: "transport", path: "/transport-types" });
    expect(upstreams.transport?.requests.at(-1)).toMatchObject({ method: "POST", body });
  });

  it.each([
    ["de outra audience", { audience: "outra" }],
    ["expirado", { expiresIn: "-1m" }],
    ["assinado por outra chave", { key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey }],
  ])("token %s: 401", async (_label, overrides) => {
    const response = await request("GET", "/api/v1/items", { token: await sign(["admin"], overrides) });

    expect(response.status).toBe(401);
  });

  it("operator nao cria usuario (403); admin cria", async () => {
    const forbidden = await request("POST", "/api/v1/users", { token: await sign(["operator"]), body: "{}" });
    const allowed = await request("POST", "/api/v1/users", { token: await sign(["admin"]), body: "{}" });

    expect(forbidden.status).toBe(403);
    expect(allowed.status).toBe(201);
    // So o ms-auth recebe o token (revalida nas rotas de usuario).
    expect(upstreams.auth?.requests.at(-1)?.headers.authorization).toMatch(/^Bearer /);
  });

  it("rota publica de login segue sem token e sem identidade", async () => {
    const response = await request("POST", "/api/v1/auth/login", { body: "{}" });

    expect(response.status).toBe(201);
    expect(upstreams.auth?.requests.at(-1)?.headers["x-user-id"]).toBeUndefined();
  });

  it("rota inexistente: 404", async () => {
    expect((await request("GET", "/api/v1/nada", { token: await sign(["admin"]) })).status).toBe(404);
  });

  it("servico fora do ar: 502; servico lento: 504; sem vazar detalhe", async () => {
    const token = await sign(["admin"]);

    const down = await request("GET", "/api/v1/customers", { token });
    const slow = await request("GET", "/api/v1/sales-orders/slow", { token });

    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ statusCode: 502, error: "Bad Gateway", message: "Servico indisponivel" });
    expect(slow.status).toBe(504);
  });

  it("corpo acima de MAX_BODY_BYTES: 413", async () => {
    const response = await request("POST", "/api/v1/items", {
      token: await sign(["admin"]),
      body: JSON.stringify({ blob: "x".repeat(2_000) }),
    });

    expect(response.status).toBe(413);
  });

  it("health: live e ready (JWKS no ar)", async () => {
    expect((await request("GET", "/health/live")).status).toBe(200);
    expect((await request("GET", "/health/ready")).status).toBe(200);
  });

  it("porta publica nao serve /metrics (404); health continua nela", async () => {
    const publicMetrics = await request("GET", "/metrics");

    expect(publicMetrics.status).toBe(404);
    expect(await publicMetrics.text()).not.toContain("http_request_duration_seconds");
    expect((await request("GET", "/health/live")).status).toBe(200);
    expect((await fetch(`${metricsUrl}/health/live`)).status).toBe(404);
  });

  it("porta de metricas: latencia pelo prefixo da rota, nunca pelo path concreto, e erros de proxy", async () => {
    const response = await fetch(`${metricsUrl}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(
      sampleValue(text, "http_request_duration_seconds_count", {
        method: "GET",
        route: "/api/v1/items",
        status_code: "200",
      }),
    ).toBe(1);
    expect(text).not.toContain("/api/v1/items/abc");
    expect(sampleValue(text, "gateway_proxy_errors_total", { upstream: "customer", kind: "bad_gateway" })).toBe(1);
    expect(sampleValue(text, "gateway_proxy_errors_total", { upstream: "salesOrder", kind: "timeout" })).toBe(1);
  });
});
