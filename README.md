# ms-gateway

Ponto único de entrada da plataforma (NestJS). Cada requisição passa por:

1. **Roteamento**: `/api/v1/<recurso>` vai para o serviço dono do recurso.
2. **Autenticação**: JWT RS256 emitido pelo [ms-auth](../ms-auth/README.md),
   validado localmente com o JWKS em cache. Sem uma chamada ao ms-auth por
   requisição.
3. **Autorização**: política por rota e por tipo de operação.
4. **Encaminhamento**: o corpo segue em stream (o gateway não lê nem
   reserializa). Headers de identidade e o correlationId são injetados.

## Arquitetura

- `src/domain/routing/route-table.ts`: tabela de rotas e política de acesso,
  pura e testável. É o único lugar para declarar uma rota nova.
- `src/application`: `AuthorizeRequestUseCase` resolve a rota, valida o token
  pelo port `TokenVerifier` e aplica a política.
- `src/infrastructure`:
  - `JwksTokenVerifier`: jose `createRemoteJWKSet`, com cache e refetch quando
    aparece um `kid` desconhecido;
  - `UpstreamProxyService`: http-proxy-middleware, um proxy com pool de
    conexões por serviço;
  - `GatewayController`: curinga em `/api/v1/*`;
  - health.

## Rotas

| Prefixo público | Serviço | Leitura (GET/HEAD/OPTIONS) | Escrita |
|---|---|---|---|
| `/api/v1/auth/*` | ms-auth | pública | pública |
| `/api/v1/.well-known/*` | ms-auth | pública | pública |
| `/api/v1/users*` | ms-auth | autenticado | `admin` (o ms-auth também valida) |
| `/api/v1/items*` | ms-catalog | autenticado | `admin` ou `operator` |
| `/api/v1/transport-types*`, `/api/v1/catalog-items*` | ms-transport | autenticado | `admin` ou `operator` |
| `/api/v1/customers*` | ms-customer | autenticado | `admin` ou `operator` |
| `/api/v1/sales-orders*` | ms-sales-order | autenticado | `admin` ou `operator` |

- **Reescrita de path**: o prefixo `/api/v1` sai, e a query segue intacta. Por
  exemplo, `/api/v1/items/1?x=1` chega ao serviço como `/items/1?x=1`.
- **Paths recusados**: `..` e `//` dão 404 e nunca chegam aos serviços.
- **Token presente mas inválido**: é 401 mesmo em rota pública.

## Headers repassados aos serviços

| Header | Origem |
|---|---|
| `x-user-id`, `x-user-roles` | claims `sub` e `roles` do token validado; qualquer `x-user-*` enviado pelo cliente é removido |
| `x-correlation-id` | o do cliente (se válido) ou um gerado; também volta na resposta |
| `x-forwarded-for/proto/host` | adicionados pelo proxy |
| `Authorization` | **não** é repassado: os serviços confiam no gateway |

## Erros

| Situação | Status |
|---|---|
| sem token, token inválido, expirado, de outra audience ou de outra chave | 401 |
| role insuficiente | 403 |
| rota inexistente | 404 |
| `Content-Length` acima de `MAX_BODY_BYTES` | 413 |
| corpo sem `Content-Length` (chunked) | 411 |
| serviço fora do ar | 502 `Servico indisponivel` |
| serviço acima de `UPSTREAM_TIMEOUT_MS` | 504 |

O detalhe do erro de rede fica só no log.

## Como subir

```bash
cp .env.example .env
yarn install
yarn start
```

No compose do [ms-platform](../ms-platform/README.md), o gateway é o único
serviço que precisa ser exposto (porta 8000).

## Variáveis de ambiente

Validadas com Zod no boot. Veja `.env.example`.

| Variável | Padrão | Descrição |
|---|---|---|
| `UPSTREAM_*_URL` | obrigatórias | URL base de cada serviço |
| `AUTH_JWKS_URL` | obrigatória | JWKS do ms-auth |
| `AUTH_ISSUER` / `AUTH_AUDIENCE` | `ms-auth` / `ms-platform` | claims exigidas |
| `JWKS_CACHE_MAX_AGE_MS` | 600000 | cache do JWKS; um `kid` desconhecido força refetch (cooldown de 30s) |
| `UPSTREAM_TIMEOUT_MS` | 10000 | espera máxima pelo serviço |
| `MAX_BODY_BYTES` | 1048576 | limite de corpo |
| `THROTTLE_DEFAULT_TTL_MS` / `_LIMIT` | 60000 / 300 | rate limit por IP (`trust proxy` para redes privadas) |

## Métricas

`GET /metrics` (Prometheus) fica fora do curinga `/api/v1` e não é
roteado para fora. Ele expõe:

- `http_request_duration_seconds{method, route, status_code}`: o `route` é o
  prefixo resolvido (por exemplo `/api/v1/items`), nunca o path concreto, para
  manter a cardinalidade baixa;
- `gateway_proxy_errors_total{upstream, kind}`: `kind` é `bad_gateway` ou
  `timeout`.

## Health

- `/health/live`: o processo responde.
- `/health/ready`: o JWKS está acessível. Os serviços internos não entram:
  uma queda deles vira 502 na rota, sem derrubar o gateway inteiro.

## Testes

```bash
yarn lint && yarn typecheck
yarn test              # tabela de rotas, política, use case, headers
yarn test:integration  # gateway real + JWKS e serviços falsos em HTTP
```

A integração assina tokens com uma chave própria e publica o JWKS dela. O
caminho ms-auth para gateway, com tokens reais, é validado no smoke do
ms-platform.

## Limitações conhecidas

- **Os serviços confiam na rede.** Eles não revalidam o JWT e leem
  `x-user-*`, então no compose só o gateway deve ser publicado. As portas dos
  serviços ficam expostas apenas para desenvolvimento no host.
- **Sem revogação de access token.** Um token vale até expirar (15 min).
- **Sem CORS configurado.** O cliente-alvo é server-to-server, ou está na
  mesma origem.
- **Rate limit em memória, por réplica.**
