#!/usr/bin/env bash

# check if heartbeat file is newer than 1 hour
if [[ $(find heartbeat -mtime -1h) ]]; then
    exit 0
fi
exit 1
