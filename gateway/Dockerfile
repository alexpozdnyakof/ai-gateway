# --- build stage: компилируем TS в dist/ ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Сначала манифесты — для кэширования слоя зависимостей.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# --- prod stage: только runtime + собранный код ---
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Только прод-зависимости (без tsx/typescript/esbuild).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
# SQL-миграции нужны рантайму (runMigrations на старте).
COPY drizzle ./drizzle

EXPOSE 8080
CMD ["node", "dist/index.js"]
