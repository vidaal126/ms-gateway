import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";

// Opcoes de criacao compartilhadas entre main.ts e os testes: sem body-parser,
// o corpo segue em stream para o servico (o gateway nao le nem reserializa).
export const GATEWAY_APP_OPTIONS = { bodyParser: false } as const;

export function configureApp(app: INestApplication): void {
  app.use(helmet());
  // Gateway atras de proxy/LB: IP real do cliente (throttler, X-Forwarded-For).
  if (isExpress(app)) app.set("trust proxy", "loopback, linklocal, uniquelocal");
}

function isExpress(app: INestApplication): app is NestExpressApplication {
  return "set" in app;
}
