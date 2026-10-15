FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY bin ./bin
RUN chmod +x /app/bin/dingtalk-grokbot-tool.js \
    && ln -s /app/bin/dingtalk-grokbot-tool.js /usr/local/bin/dingtalk-grokbot-tool

USER node

CMD ["node", "src/index.js"]
