import { DomainError, EntityNotFoundError } from "./domain.error";

// Categorias do gateway mapeadas pelo filtro global (401/403/404).
export abstract class AuthenticationError extends DomainError {}
export abstract class AuthorizationError extends DomainError {}

export class MissingOrInvalidTokenError extends AuthenticationError {
  constructor() {
    super("Token de acesso ausente, invalido ou expirado");
  }
}

export class ForbiddenRouteError extends AuthorizationError {
  constructor() {
    super("Permissao insuficiente para esta operacao");
  }
}

export class RouteNotFoundError extends EntityNotFoundError {
  constructor() {
    super("Rota nao encontrada");
  }
}
