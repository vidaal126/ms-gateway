# syntax=docker/dockerfile:1

# ---- base: versao do Node e arquivos de dependencia --------------------------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json yarn.lock ./

# ---- deps: todas as dependencias (build) -------------------------------------
FROM base AS deps
RUN yarn install --frozen-lockfile --ignore-scripts

# ---- builder: compila --------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

# ---- prod-deps: so dependencias de producao ---------------------------------
FROM base AS prod-deps
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));delete p.devDependencies;fs.writeFileSync('package.json',JSON.stringify(p,null,2))" && \
    yarn install --production --ignore-scripts --non-interactive && \
    yarn cache clean

# ---- production: runtime minimo, usuario nao-root ---------------------------
FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache libc6-compat dumb-init && \
    addgroup -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nestjs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
ENV PORT=8080
EXPOSE 8080
# dumb-init como PID 1 repassa o SIGTERM para o Node (graceful shutdown).
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
