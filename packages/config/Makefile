LANG := en_US.UTF-8
SHELL := /bin/bash
.SHELLFLAGS := --norc --noprofile -e -u -o pipefail -c
.DEFAULT_GOAL := test

nvm_brew = /usr/local/opt/nvm/nvm.sh
ifneq ("$(wildcard $(nvm_brew))", "")
	nvm_sh = $(nvm_brew)
endif
nvm_default = $(HOME)/.nvm/nvm.sh
ifneq ("$(wildcard $(nvm_default))", "")
	nvm_sh = $(nvm_default)
endif
export NODE_VERSION = $(shell cat ../../.nvmrc)
define npm
	@$(eval npm_args=$(1))
	bash --norc --noprofile -e -o pipefail -l -c "source $(nvm_sh) && nvm exec npm $(npm_args)"
endef
export NODE_ENV := "development"

.PHONY: test
test: ## Run tests
	$(call npm, test)

.PHONY: lint
lint: ## Run lint
	$(call npm, run lint)

.PHONY: build
build: NODE_ENV = "production"
build: ## Run build
	$(call npm, run build)

.PHONY: npm-install
npm-install:
	$(call npm, install)

.PHONY: npm-publish
npm-publish:
	$(call npm, publish . --access public)

.PHONY: npm-pack
npm-pack:
	$(call npm, pack)

.PHONY: clean
clean: ## Remove generated files
	$(RM) -r \
		build \
		dist \
		node_modules

.PHONY: help
help: ## Show Help
	@grep -E '^[a-zA-Z0-9_\-\/]+%?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-20s %s\n", $$1, $$2}' | sort
