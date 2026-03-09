FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy Prisma schema
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source
COPY . .

# Expose port
EXPOSE $PORT

# Start server
CMD ["node", "server.js"]