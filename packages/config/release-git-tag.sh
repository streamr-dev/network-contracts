#!/bin/bash

set -e -u -o pipefail

function usage() {
	local name
	name=$(basename "$0")
	echo "$name: Tag new version in Git" 1>&2
	echo "Usage: $name [-h] semver" 1>&2
	echo "	-h Show help" 1>&2
	echo "Example: $name 0.2.7" 1>&2
}

while getopts "h" arg; do
	case $arg in
	h|*) # Show help
		usage
		exit 1
	;;
	esac
done

version="${1-}"
if test -z "$version"; then
	usage
	exit 1
fi

./release-validate-semver.sh "$version"

# check for unstaged changes
if ! git diff --exit-code --quiet; then
	echo "$(basename "$0"): error: git workspace is dirty" 1>&2
	exit 1
fi
# check for staged, but not committed changes
if ! git diff --cached --exit-code --quiet; then
	echo "$(basename "$0"): error: git workspace is dirty" 1>&2
	exit 1
fi
# check for no changes to be committed
if output=$(git status --porcelain=v1) && test -n "$output"; then
	echo "$(basename "$0"): error: git workspace is dirty" 1>&2
	exit 1
fi

./release-npm-update-version-package-json.sh "$version"

# Create release commit
git commit --message="Release ${version}"
git push
# Create tag
git tag --message="Release ${version}" --annotate "v${version}"
git push origin "v${version}"
