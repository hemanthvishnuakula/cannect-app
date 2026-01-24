FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, resvg)
RUN apk add --no-cache python3 make g++ 

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY *.js ./

# Create data directory (will be mounted as volume)
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/.well-known/did.json || exit 1

# Start the server
CMD ["node", "index.js"]
