import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

// Mede cada requisicao por um label de cardinalidade limitada: o prefixo da
// rota resolvida pelo gateway (res.locals, ex.: /api/v1/items) ou, nas rotas
// proprias (health), o template do Nest. Nunca o path concreto.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    res.once("finish", () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.observeHttp(req.method, routeLabel(req, res), res.statusCode, seconds);
    });
    next();
  }
}

export const METRICS_ROUTE_LOCAL = "metricsRoute";

function routeLabel(req: Request, res: Response): string {
  const resolved: unknown = res.locals[METRICS_ROUTE_LOCAL];
  if (typeof resolved === "string") return resolved;
  return routeTemplate(req);
}

function routeTemplate(req: Request): string {
  const route: unknown = req.route;
  if (typeof route === "object" && route !== null && "path" in route && typeof route.path === "string") {
    return `${req.baseUrl}${route.path}`;
  }
  return "unmatched";
}
