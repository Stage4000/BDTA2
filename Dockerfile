# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/docs ./docs
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/.env.production.example ./.env.production.example

# Available runtime entrypoints:
# - node dist/apps/api/src/main.js
# - node dist/apps/web/src/main.js
# - node dist/apps/jobs/src/main.js
# - node dist/apps/migrate/src/main.js
USER node
EXPOSE 3001

CMD ["node", "dist/apps/web/src/main.js"]
