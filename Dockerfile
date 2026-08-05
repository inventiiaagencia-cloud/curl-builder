FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY curl-builder ./curl-builder
COPY data ./data

ENV HOST=0.0.0.0
ENV RUNTIME_STATE_FILE=/app/data/runtime-state.json
EXPOSE 3020

CMD ["node", "curl-builder/server.js"]
