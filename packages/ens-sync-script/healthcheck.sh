#!/usr/bin/env bash

# dev-docker health check: check if heartbeat file is newer than 5 minutes
echo "healthcheck: checking heartbeat file"
if [[ $(find heartbeat-dev2-dev2 -mtime -0.0035) ]]; then
    exit 0
fi
exit 1
