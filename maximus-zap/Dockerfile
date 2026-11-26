FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY src ./src
COPY server ./server
ENV PORT=8787 MAXIMUS_DB=/data/maximus.db
VOLUME /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
