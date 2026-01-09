# =====================================
# Stage 1: Build Frontend
# =====================================
FROM node:18-bookworm-slim AS frontend-builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./
COPY .yarn ./.yarn
COPY .yarnrc.yml ./

# Install dependencies
RUN yarn install

# Copy source code and configs
COPY src ./src
COPY vite.config.web.ts ./
COPY tsconfig.json ./
COPY tsconfig.*.json ./

# Create output directory
RUN mkdir -p backend/web

# Build frontend for web
ENV VITE_API_URL=http://localhost:8080
RUN yarn build:web

# =====================================
# Stage 2: Runtime Image
# =====================================
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# Verify installations
RUN ffmpeg -version && yt-dlp --version

# Create non-root user
RUN groupadd -g 1000 losslesscut && \
    useradd -u 1000 -g losslesscut -m losslesscut

# Create directories with proper structure
RUN mkdir -p /var/losslesscut/uploads /var/losslesscut/outputs /var/losslesscut/projects /app/web && \
    chown -R losslesscut:losslesscut /var/losslesscut /app

WORKDIR /app

# Copy pre-built Go binary (we don't have Go source)
COPY backend/lossless-cut-server ./server

# Copy frontend build from stage 1
COPY --from=frontend-builder /app/backend/web ./web

# Copy config
COPY backend/config/config.yaml /etc/losslesscut/config.yaml

# Make binary executable
RUN chmod +x ./server && chown losslesscut:losslesscut ./server

# Use non-root user
USER losslesscut

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables
ENV LOSSLESSCUT_STORAGE_BASE_PATH=/var/losslesscut

# Run the server
CMD ["./server", "--config", "/etc/losslesscut/config.yaml"]
