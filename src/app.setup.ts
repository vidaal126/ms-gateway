import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";

// Opcoes de criacao compartilhadas entre main.ts e os testes: sem body-parser,
// o corpo segue em stream para o servico (o gateway nao le nem reserializa).
export const GATEWAY_APP_OPTIONS = { bodyParser: false } as const;

export function configureApp(app: INestApplication): void {
  app.use(helmet());
  // Sem "trust proxy": o gateway e a borda, entao req.ip e o IP do socket e um
  // X-Forwarded-For enviado pelo cliente nao troca a chave do throttler.
}
