#!/bin/bash

REMOTE_USER="lobin"
REMOTE_HOST="vpn.agaii.org"
REMOTE_PORT="26999"
LOCAL_PORT="8000"

echo "Starting tunnel maintainer..."
echo "Forwarding remote port $REMOTE_PORT to local port $LOCAL_PORT"

while true; do
    echo "[$(date)] Connecting tunnel..."
    ssh -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -R $REMOTE_PORT:localhost:$LOCAL_PORT $REMOTE_USER@$REMOTE_HOST -N
    
    echo "[$(date)] Tunnel disconnected. Retrying in 5 seconds..."
    sleep 5
done
