# Use the Puppeteer-optimized base image
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json for dependency installation
COPY backend/functions/package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY backend/functions .

# Build the application
RUN npm run build

# Create local storage directory and set permissions
RUN mkdir -p /app/local-storage && chmod 777 /app/local-storage

# Create a non-root user for security
RUN useradd -m pptruser && chown -R pptruser:pptruser /app

# Switch to the non-root user
USER pptruser

# Set environment variables
ENV PORT=8072

# Expose the port the app runs on
EXPOSE 8072

# Start the application
CMD ["node", "build/server.js"]