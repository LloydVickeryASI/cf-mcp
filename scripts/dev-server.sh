#!/bin/bash
# Development server with proper signal handling

# Trap signals and clean up
cleanup() {
    echo ""
    echo "🛑 Shutting down development server..."
    
    # Kill any child processes
    pkill -P $$ 2>/dev/null
    
    # Kill wrangler processes
    ./scripts/kill-wrangler.sh >/dev/null 2>&1
    
    exit 0
}

# Set up signal handlers
trap cleanup INT TERM EXIT

# Start wrangler dev
echo "🚀 Starting development server..."
pnpm wrangler dev "$@" &

# Save the PID
WRANGLER_PID=$!

# Wait for the process
wait "$WRANGLER_PID"