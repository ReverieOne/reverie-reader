#!/bin/bash

# Navigate to the backend functions directory
cd backend/functions || exit 1

# Install dependencies
echo "Installing dependencies..."
npm install || {
    echo "Failed to install dependencies"
    exit 1
}

# Run the development server
echo "Starting development server..."
export PORT=3050
npx nodemon --watch ./src --exec "npm run build && node build/server.js"
