#!/bin/bash

set -e -u -o pipefail

function usage() {
	local name
	name=$(basename "$0")
	echo "$name: Publish new version in Npm" 1>&2
	echo "Usage: $name [-h]" 1>&2
	echo "	-h Show help" 1>&2
	echo "Example: $name" 1>&2
}

while getopts "h" arg; do
	case $arg in
	h|*) # Show help
		usage
		exit 1
	;;
	esac
done

npm publish . --access public
