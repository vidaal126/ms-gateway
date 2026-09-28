import {
  All,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { resolveCorrelationId } from "@common/correlation/correlation-id";
import { AuthorizeRequestUseCase } from "@application/use-cases/authorize-request.use-case";
import { type Env, readEnv } from "@config/env";
import { METRICS_ROUTE_LOCAL } from "@infrastructure/metrics/http-metrics.middleware";
import { sanitizeForwardedHeaders } from "@infrastructure/proxy/forwarded-headers";
import { UpstreamProxyService } from "@infrastructure/proxy/upstream-proxy.service";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD", "OPTIONS", "DELETE"]);

// Ponto unico de entrada: toda rota /api/v1/* passa por autorizacao e segue
// em stream para o servico dono. Erros de autorizacao/rota lancam antes de
// qualquer byte ser escrito e viram 401/403/404 pelo filtro global.
@Controller("api/v1")
export class GatewayController {
  private readonly maxBodyBytes: number;

  constructor(
    private readonly authorize: AuthorizeRequestUseCase,
    private readonly proxy: UpstreamProxyService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.maxBodyBytes = readEnv(config, "MAX_BODY_BYTES");
  }

  @All("*path")
  async forward(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.locals[METRICS_ROUTE_LOCAL] = "unresolved";
    this.assertBodySize(req);
    const { target, principal } = await this.authorize.execute({
      method: req.method,
      url: req.originalUrl,
      authorization: req.header("authorization"),
    });
    res.locals[METRICS_ROUTE_LOCAL] = `/api/v1${target.route.prefix}`;
    sanitizeForwardedHeaders(req.headers, principal, resolveCorrelationId(req.id));
    await this.proxy.forward(target.route.upstream, target.upstreamPath, req, res);
  }

  // O corpo nao e lido pelo gateway (segue em stream): o limite vale pelo
  // Content-Length declarado; corpo sem tamanho declarado e recusado.
  private assertBodySize(req: Request): void {
    if (METHODS_WITHOUT_BODY.has(req.method)) return;
    const declared = req.header("content-length");
    if (declared === undefined) {
      if (req.header("transfer-encoding") === undefined) return;
      throw new HttpException("Content-Length obrigatorio", HttpStatus.LENGTH_REQUIRED);
    }
    const size = Number.parseInt(declared, 10);
    if (!Number.isFinite(size) || size < 0) {
      throw new HttpException("Content-Length invalido", HttpStatus.BAD_REQUEST);
    }
    if (size > this.maxBodyBytes) {
      throw new HttpException("Corpo da requisicao muito grande", HttpStatus.PAYLOAD_TOO_LARGE);
    }
  }
}
