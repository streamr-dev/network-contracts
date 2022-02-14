LANG := en_US.UTF-8
SHELL := /bin/bash
.SHELLFLAGS := --norc --noprofile -e -u -o pipefail -c
.DEFAULT_GOAL = test

nvm_brew = /usr/local/opt/nvm/nvm.sh
ifneq ("$(wildcard $(nvm_brew))", "")
	nvm_sh = $(nvm_brew)
endif
nvm_default = $(HOME)/.nvm/nvm.sh
ifneq ("$(wildcard $(nvm_default))", "")
	nvm_sh = $(nvm_default)
endif
node_version = $(shell cat ../../.nvmrc)
define npm
	@$(eval npm_args=$(1))
	bash --norc --noprofile -e -o pipefail -l -c "source $(nvm_sh) && nvm exec $(node_version) npm $(npm_args)"
endef

node_modules: ## Run 'npm ci' if node_modules directory doesn't exist
	$(call npm, ci)

.PHONY: test
test: node_modules ## Run tests
	$(call npm, test)

.PHONY: lint
lint: node_modules ## Run lint
	$(call npm, run lint)

.PHONY: build
build: node_modules ## Run build
	$(call npm, run build)

.PHONY: clean
clean: ## Remove generated files
	$(RM) -r \
		dist \
		node_modules

.PHONY: help
help: ## Show Help
	@grep -E '^[a-zA-Z0-9_\-\/]+%?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-20s %s\n", $$1, $$2}' | sort
