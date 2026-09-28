import type { Role } from "@domain/routing/route-table";

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

export interface Principal {
  readonly userId: string;
  readonly roles: readonly Role[];
}

export interface TokenVerifier {
  // Assinatura, iss, aud e exp validos: Principal. Qualquer falha: undefined.
  verify(token: string): Promise<Principal | undefined>;
}
