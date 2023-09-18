#!/usr/bin/env bash

# check if heartbeat file is newer than 5 minutes
echo "healthcheck: checking heartbeat file"
if [[ $(find heartbeat -mtime -0.0035) ]]; then
    exit 0
fi
exit 1
