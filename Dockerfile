FROM node:18-alpine

WORKDIR /app

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