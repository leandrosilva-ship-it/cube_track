// Augmenta o `Request` do Express com o corpo bruto capturado em `bootstrap.ts` (verify do
// body-parser) — usado pela verificação de assinatura dos webhooks de entrada (GitHub/Slack, ADR 0056).
import 'express';

declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}
