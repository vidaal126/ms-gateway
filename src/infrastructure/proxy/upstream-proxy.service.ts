import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { createProxyMiddleware, type RequestHandler } from "http-proxy-middleware";
import { type ILogger, LOGGER_TOKEN } from "@common/logger/logger.interface";
import type { Upstream } from "@domain/routing/route-table";
import { type Env, readEnv } from "@config/env";

type UpstreamUrlKey =
  | "UPSTREAM_AUTH_URL"
  | "UPSTREAM_CATALOG_URL"
  | "UPSTREAM_TRANSPORT_URL"
  | "UPSTREAM_CUSTOMER_URL"
  | "UPSTREAM_SALES_ORDER_URL";

// Um proxy (com pool de conexoes proprio) por servico interno. O corpo nao
// passa pelo body-parser do Nest: segue em stream para o servico.
@Injectable()
export class UpstreamProxyService {
  private readonly proxies: Record<Upstream, RequestHandler>;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    const timeoutMs = readEnv(config, "UPSTREAM_TIMEOUT_MS");
    const proxy = (upstream: Upstream, key: UpstreamUrlKey): RequestHandler =>
      this.createProxy(upstream, readEnv(config, key), timeoutMs);
    this.proxies = {
      auth: proxy("auth", "UPSTREAM_AUTH_URL"),
      catalog: proxy("catalog", "UPSTREAM_CATALOG_URL"),
      transport: proxy("transport", "UPSTREAM_TRANSPORT_URL"),
      customer: proxy("customer", "UPSTREAM_CUSTOMER_URL"),
      salesOrder: proxy("salesOrder", "UPSTREAM_SALES_ORDER_URL"),
    };
  }

  // Resolve quando a resposta termina (ou o cliente desiste).
  forward(upstream: Upstream, upstreamPath: string, req: Request, res: Response): Promise<void> {
    req.url = upstreamPath;
    return new Promise((resolve) => {
      res.once("finish", resolve);
      res.once("close", resolve);
      void this.proxies[upstream](req, res, () => {
        resolve();
      });
    });
  }

  private createProxy(upstream: Upstream, target: string, timeoutMs: number): RequestHandler {
    return createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      // Tempo maximo esperando o servico; estourado, vira 504.
      proxyTimeout: timeoutMs,
      on: {
        error: (err: Error, _req: IncomingMessage, res: ServerResponse | Socket): void => {
          this.onProxyError(upstream, err, res);
        },
      },
    });
  }

  // Detalhe do erro so no log: o cliente recebe 502/504 generico.
  private onProxyError(upstream: Upstream, err: Error, res: ServerResponse | Socket): void {
    const code = "code" in err && typeof err.code === "string" ? err.code : undefined;
    const timedOut = code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT";
    this.logger.warn("Falha ao encaminhar requisicao ao servico", { upstream, code, error: err.message });

    if (!("writeHead" in res) || res.headersSent) {
      res.destroy();
      return;
    }
    const statusCode = timedOut ? 504 : 502;
    res.writeHead(statusCode, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        statusCode,
        error: timedOut ? "Gateway Timeout" : "Bad Gateway",
        message: timedOut ? "Servico nao respondeu a tempo" : "Servico indisponivel",
      }),
    );
  }
}
