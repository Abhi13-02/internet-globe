FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV REDIS_URL=redis://redis:6379/0

CMD ["npm", "start"]
