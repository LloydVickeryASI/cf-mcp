#!/bin/bash
# Kill hanging wrangler processes

echo "🔍 Finding hanging wrangler/workerd processes..."

# Kill all wrangler-related processes
for process in wrangler workerd miniflare node; do
    pids=$(pgrep -f "$process.*wrangler")
    if [ -n "$pids" ]; then
        echo "   Killing $process processes: $pids"
        kill -9 $pids 2>/dev/null
    fi
done

# Kill any processes using wrangler ports
echo "🔍 Checking for processes on wrangler ports..."
for port in 8788 8787 4003 3000; do
    pid=$(lsof -ti :$port 2>/dev/null)
    if [ ! -z "$pid" ]; then
        echo "   Killing process $pid on port $port"
        kill -9 $pid 2>/dev/null
    fi
done

# Clear any lingering socket files
echo "🧹 Cleaning up socket files..."
rm -f /tmp/.workerd-* 2>/dev/null

echo "✅ Done. You can now restart wrangler dev."