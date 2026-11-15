FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
# Heap réglable sans rebuild : surcharger NODE_OPTIONS via les variables Blitz
# dès qu'on alloue plus de RAM au conteneur (ex: --max-old-space-size=384).
ENV NODE_OPTIONS=--max-old-space-size=96
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
