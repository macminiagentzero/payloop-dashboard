FROM node:18-slim

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

# Copy source
COPY . .

# Expose port
EXPOSE $PORT

# Start server
CMD ["node", "server.js"]