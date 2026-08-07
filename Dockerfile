FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY curl-builder ./curl-builder
COPY data ./data

# Variaveis de ambiente padrao
ENV HOST=0.0.0.0
ENV PORT=3020
ENV RUNTIME_STATE_FILE=/app/data/state/runtime-state.json

# Garante que o diretorio de estado existe
RUN mkdir -p /app/data/state

EXPOSE 3020

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3020/health || exit 1

CMD ["node", "curl-builder/server.js"]
