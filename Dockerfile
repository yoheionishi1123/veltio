FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY server ./server
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=3210

EXPOSE 3210

CMD ["npm", "start"]
