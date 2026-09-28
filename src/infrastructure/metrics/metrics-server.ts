import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Registry } from "prom-client";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import { type Env, readEnv } from "@config/env";
import { MetricsService } from "./metrics.service";

// Servidor HTTP proprio para o scrape do Prometheus, em METRICS_PORT: a porta
// publica do gateway nao serve /metrics. So GET /metrics; o resto e 404.
@Injectable()
export class MetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly configuredPort: number;
  private server: Server | null = null;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
    config: ConfigService<Env, true>,
  ) {
    this.configuredPort = readEnv(config, "METRICS_PORT");
  }

  // Porta efetiva (METRICS_PORT=0 escolhe uma livre, util nos testes).
  get port(): number {
    const address = this.server?.address();
    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("Servidor de metricas nao esta escutando");
    }
    return address.port;
  }

  // Erro ao escutar (porta ocupada) derruba o boot.
  async onApplicationBootstrap(): Promise<void> {
    const server = createServer((req, res): void => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.configuredPort, (): void => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.log("Metricas em HTTP interno", { port: this.port });
  }

  // Scrape em andamento termina; conexoes keep-alive ociosas sao fechadas
  // para o close nao esperar o timeout delas.
  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close((): void => {
        resolve();
      });
      server.closeIdleConnections();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" || path !== "/metrics") {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }
    try {
      const body = await this.metrics.render();
      res.writeHead(200, { "content-type": Registry.PROMETHEUS_CONTENT_TYPE }).end(body);
    } catch (err) {
      this.logger.error("Falha ao gerar metricas", err instanceof Error ? err : new Error(String(err)));
      res.writeHead(500, { "content-type": "text/plain" }).end("Internal Server Error");
    }
  }
}
