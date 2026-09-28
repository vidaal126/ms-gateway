export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  // Chaves opcionais: mesmo formato do JsonObject do Prisma, para que valores
  // lidos de colunas Json sejam atribuiveis sem conversao.
  | { [key in string]?: JsonValue };
