# Use the Puppeteer-optimized base image
FROM ghcr.io/puppeteer/puppeteer:22.7.1

# Switch to root for setup
USER root

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
RUN mkdir -p /app/local-storage && \
    mkdir -p /app/build && \
    chown -R pptruser:pptruser /app && \
    chmod -R 755 /app

# Install dumb-init for better process handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PORT=8072
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Switch back to pptruser for runtime
USER pptruser

# Expose the port the app runs on
EXPOSE 8072

# Use dumb-init as entrypoint
ENTRYPOINT ["dumb-init", "--"]

# Start the application with the recommended flags
CMD ["node", "build/server.js"]