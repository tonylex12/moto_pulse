# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies)
COPY package*.json ./
RUN npm ci

# Copy Prisma schema and generate Client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source code and build TypeScript to JS
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Runner stage
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy Prisma schema and regenerate client for the production environment
COPY prisma ./prisma
RUN npx prisma generate

# Copy compiled JavaScript from the builder stage
COPY --from=builder /app/dist ./dist

# Expose port (default is 3000)
EXPOSE 3000

# Run migrations and start the application
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
