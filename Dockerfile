# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# Next.js may run API routes during "Collecting page data"; DB is not available at build time.
# Use a dummy URL so the build does not fail; real DATABASE_URL must be set at runtime.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Schema is read at runtime from process.cwd()/lib/db/schema.sql
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
