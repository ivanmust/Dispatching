# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/schema.sql ./schema.sql

ENV NODE_ENV=production
EXPOSE 3001

# Ensure uploads directory exists (can be overridden via volume)
RUN mkdir -p /app/uploads

CMD ["node", "dist/index.js"]
