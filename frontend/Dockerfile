# Standard Node.js Dockerfile for development
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
# Increase timeout for slow connections
RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm config set fetch-retries 5 && \
    npm install

# Copy source code
COPY . .

# Expose Next.js default port
EXPOSE 3000

# Next.js 13+ requires host to be 0.0.0.0 for docker
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["npm", "run", "dev"]
