# Use Node base image
FROM node:18-slim

# Install required dependencies for Puppeteer and libmagic
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-symbola \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    libmagic-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY backend/functions/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY backend/functions .

# Set environment variables
ENV PORT=8072
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose the port the app runs on
EXPOSE 8072

# Start the application
CMD ["node", "build/server.js"]