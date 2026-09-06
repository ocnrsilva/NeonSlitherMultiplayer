# ===================================================
# Stage 1: Build Frontend and Bundled Backend
# ===================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for native packages if any
RUN apk add --no-cache python3 make g++

# Copy package manifests for reproducible installation
COPY package.json package-lock.json ./

# Clean reproducible install of all dependencies
RUN npm ci

# Copy source code and Prisma schema
COPY . .

# Generate Prisma client for build
RUN npx prisma generate

# Build Vite frontend and bundle server.ts with esbuild to dist/server.cjs
RUN npm run build

# ===================================================
# Stage 2: Production Minimal Runtime
# ===================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install wget for container healthcheck
RUN apk add --no-cache wget

# Copy package manifests for production install
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and bundled backend from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and migrations for deployment / runtime
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy entrypoint script for automated migration execution before app startup
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Ensure unprivileged permissions
RUN chown -R node:node /app

# Run as non-root unprivileged user
USER node

# Expose ONLY the single application port 3010
EXPOSE 3010

# Healthcheck verified against internal HTTP health endpoint on 3010
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3010/api/health || exit 1

# Execute migrations then start the server
ENTRYPOINT ["./docker-entrypoint.sh"]
