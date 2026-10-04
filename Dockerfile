# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @trueiris/api...
RUN pnpm --filter @trueiris/api build
RUN pnpm --filter @trueiris/api deploy --prod /runtime

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production TRUEIRIS_API_HOST=0.0.0.0 TRUEIRIS_API_PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(6000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
