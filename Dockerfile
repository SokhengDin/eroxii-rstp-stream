# Build stage for React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage with Node.js + FFmpeg for streaming
FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm install ws express bcryptjs jsonwebtoken dotenv

# Copy server files
COPY server.js ./
COPY serve.js ./

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/dist ./dist

# Copy jsmpeg for static serving
COPY public/jsmpeg.min.js ./dist/

# Expose ports: 80 for web app, 3001 for API, 9900-9910 for WebSocket streams
EXPOSE 80 3001 9900 9901 9902 9903 9904 9905 9906 9907 9908 9909 9910

# Start the server
CMD ["node", "serve.js"]