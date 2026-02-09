#!/bin/bash

# Activate virtual environment
source server_py/venv/bin/activate

# Trap SIGINT/SIGTERM to kill child processes
trap 'kill $(jobs -p)' SIGINT SIGTERM

echo "Starting LLM Paper Reader Services..."

# Start Backend
echo "Starting Backend..."
python server_py/main.py &
BACKEND_PID=$!

# Wait a moment for backend to initialize
sleep 2

# Start Tunnel
echo "Starting Tunnel..."
./tunnel-maintainer.sh &
TUNNEL_PID=$!

echo "Services started. Backend PID: $BACKEND_PID, Tunnel PID: $TUNNEL_PID"
echo "Press Ctrl+C to stop."

# Wait for processes
wait
