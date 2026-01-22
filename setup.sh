#!/bin/bash

echo "Setting up backend dependencies..."

# Install npm dependencies
npm install

# Create next-env.d.ts for Next.js types
echo "Backend setup complete!"
echo "Run 'npm run dev' to start the development server."
echo "Run 'npm run deploy' to deploy to Cloudflare Workers."
