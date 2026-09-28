import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { SERVICE_NAME } from "@config/service";

export type ProxyErrorKind = "bad_gateway" | "timeout";

// Registry proprio (nao o global do prom-client): testes sobem varias
// instancias do app no mesmo processo sem colisao de metricas.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly httpDuration: Histogram<"method" | "route" | "status_code">;
  private readonly proxyErrors: Counter<"upstream" | "kind">;

  constructor() {
    this.registry.setDefaultLabels({ service: SERVICE_NAME });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "Duracao das requisicoes HTTP por rota (template) e status",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.proxyErrors = new Counter({
      name: "gateway_proxy_errors_total",
      help: "Falhas ao encaminhar para um servico (502 indisponivel, 504 timeout)",
      labelNames: ["upstream", "kind"],
      registers: [this.registry],
    });
  }

  observeHttp(method: string, route: string, statusCode: number, seconds: number): void {
    this.httpDuration.observe({ method, route, status_code: String(statusCode) }, seconds);
  }

  recordProxyError(upstream: string, kind: ProxyErrorKind): void {
    this.proxyErrors.inc({ upstream, kind });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
