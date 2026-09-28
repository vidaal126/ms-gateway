import { ConfigService } from "@nestjs/config";
import type { ILogger } from "@common/logger/logger.interface";
import type { Env } from "@config/env";
import { validateEnv } from "@config/env";
import { MetricsServer } from "./metrics-server";
import { MetricsService } from "./metrics.service";

const silentLogger: ILogger = {
  log: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  debug: (): void => undefined,
};

describe("MetricsServer", () => {
  let metrics: MetricsService;
  let server: MetricsServer;
  let baseUrl: string;

  beforeEach(async () => {
    metrics = new MetricsService();
    server = new MetricsServer(metrics, silentLogger, new ConfigService<Env, true>({ METRICS_PORT: 0 }));
    await server.onApplicationBootstrap();
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.onApplicationShutdown();
  });

  it("GET /metrics devolve o registry no formato do Prometheus", async () => {
    metrics.recordProxyError("catalog", "timeout");

    const response = await fetch(`${baseUrl}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain('gateway_proxy_errors_total{upstream="catalog",kind="timeout"');
  });

  it("aceita query string no scrape", async () => {
    expect((await fetch(`${baseUrl}/metrics?x=1`)).status).toBe(200);
  });

  it.each([
    ["GET", "/"],
    ["GET", "/health/live"],
    ["GET", "/api/v1/items"],
    ["POST", "/metrics"],
  ])("%s %s: 404", async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method });

    expect(response.status).toBe(404);
    await response.text();
  });

  it("depois do shutdown a porta para de responder", async () => {
    await (await fetch(`${baseUrl}/metrics`)).text();

    await server.onApplicationShutdown();

    await expect(fetch(`${baseUrl}/metrics`)).rejects.toThrow();
    expect(() => server.port).toThrow(/nao esta escutando/);
  });

  it("porta ocupada derruba o boot", async () => {
    const clash = new MetricsServer(
      new MetricsService(),
      silentLogger,
      new ConfigService<Env, true>({ METRICS_PORT: server.port }),
    );

    await expect(clash.onApplicationBootstrap()).rejects.toThrow(/EADDRINUSE/);
  });
});

describe("env: METRICS_PORT", () => {
  const required = {
    UPSTREAM_AUTH_URL: "http://auth:3002",
    UPSTREAM_CATALOG_URL: "http://catalog:3000",
    UPSTREAM_TRANSPORT_URL: "http://transport:3001",
    UPSTREAM_CUSTOMER_URL: "http://customer:3003",
    UPSTREAM_SALES_ORDER_URL: "http://sales:3004",
    AUTH_JWKS_URL: "http://auth:3002/.well-known/jwks.json",
  };

  it("padrao 9464, separado da porta publica", () => {
    expect(validateEnv(required)).toMatchObject({ PORT: 8088, METRICS_PORT: 9464 });
  });

  it("rejeita METRICS_PORT igual a PORT", () => {
    expect(() => validateEnv({ ...required, PORT: "9000", METRICS_PORT: "9000" })).toThrow(/diferente de PORT/);
  });
});
