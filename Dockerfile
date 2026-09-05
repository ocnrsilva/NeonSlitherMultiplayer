# ===================================================
# Stage 1: Build Frontend and Bundled Backend
# ===================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for native packages if any
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package.json ./

# Install all dependencies (including devDependencies for bundling)
RUN npm install

# Copy source files
COPY . .

# Build Vite frontend and bundle server.ts with esbuild to dist/server.cjs
RUN npm run build

# ===================================================
# Stage 2: Production Minimal Runtime
# ===================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install curl/wget for healthchecks
RUN apk add --no-cache wget

# Copy package manifest
COPY package.json ./

# Install only production dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled frontend and bundled backend from builder
COPY --from=builder /app/dist ./dist

# Create non-root security context
USER node

# Expose ONLY the single application port
EXPOSE 3000

# Healthcheck verified against internal HTTP health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Start the unified server
CMD ["node", "dist/server.cjs"]
