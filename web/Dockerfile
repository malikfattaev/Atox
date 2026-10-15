FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# У сайта нет зависимостей: достаточно сервера и его файлов.
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node pages ./pages
COPY --chown=node:node partials ./partials
COPY --chown=node:node public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
