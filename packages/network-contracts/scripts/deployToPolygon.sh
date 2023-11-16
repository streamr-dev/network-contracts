#!/usr/bin/env bash
set -euxo pipefail

export CHAIN=polygon
npm run deployTokenomicsContracts

export NEW_ADMIN_ADDRESS=0x63f74A64fd334122aB5D29760C6E72Fb4b752208
export SKIP_REVOKE_CONFIGURATOR=1
export SCRIPT_FILE=scripts/handOverAdminRolesTo.ts
npm run hardhatScript
