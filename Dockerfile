# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# Empty VITE_API_URL = relative /api/* calls (same origin, single container)
RUN VITE_API_URL="" npm run build


# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Install backend production dependencies only
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source (tsx compiles on-the-fly; no separate build step needed)
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Serve the built React app as static files
COPY --from=frontend-builder /app/frontend/dist ./public

# SQLite data dir (only used when TURSO_DATABASE_URL=file:./data/data.db)
RUN mkdir -p /app/data

# Drop root privileges
RUN addgroup -S ophunt && adduser -S ophunt -G ophunt \
    && chown -R ophunt:ophunt /app
USER ophunt

EXPOSE 8080

ENV PORT=8080 \
    NODE_ENV=production

CMD ["node_modules/.bin/tsx", "src/server.ts"]
