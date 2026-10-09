FROM node:22-alpine

WORKDIR /app

RUN mkdir -p /app/data

COPY package*.json ./


RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
