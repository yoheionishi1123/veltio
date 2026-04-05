FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server ./server
COPY README.md ./

ENV NODE_ENV=production

EXPOSE 3210

CMD ["npm", "start"]
