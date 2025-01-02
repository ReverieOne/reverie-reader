FROM node:18-slim

# Install required dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-symbola \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Clear npm cache and install dependencies
RUN npm install

# Copy source
COPY src/ ./src/

ENV PORT=8072

# Expose port
EXPOSE 8072

# Start server
CMD [ "npm", "start" ]