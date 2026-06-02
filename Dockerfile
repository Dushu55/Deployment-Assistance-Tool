# syntax=docker/dockerfile:1
# DAT GitHub App (Probot) image. Multi-stage: build with full deps, ship a slim non-root runtime.

# ---- builder: install ALL deps and compile TypeScript to dist/ ----
# Debian-slim (glibc), not alpine: the @ast-grep/cli runtime dep ships a glibc native binary and
# fails its postinstall on alpine/musl.
FROM node:20-slim AS builder
WORKDIR /usr/src/app
# Don't download Chromium during install: puppeteer's PDF path isn't used in the container
# (the app posts Check Runs / HTML), and slim has no unzip for the browser archive.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
# Full install — `npm run build` needs the TypeScript devDependency.
RUN npm ci
COPY . .
RUN npm run build

# ---- runner: production-only deps + compiled output ----
FROM node:20-slim AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Google Cloud Run provides PORT (default 8080); Probot honors it.
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /usr/src/app/dist ./dist

# Run as the image's built-in non-root user (Checkov CKV_DOCKER_3 / Dockle CIS-DI-0001).
USER node
EXPOSE 8080

# Liveness: the Probot server answers HTTP on PORT (Checkov CKV_DOCKER_2).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Start the Probot GitHub App listener.
CMD ["npm", "run", "start:app"]
