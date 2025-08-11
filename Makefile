all: lint build test

build: $(wildcard packages/*)

lint:
	pnpm prettier -c .
	pnpm eslint .

test:

format:
	pnpm prettier -w .

packages/%: FORCE
	cd $@ && rm -rf dist && pnpm tsc && pnpm tsc-esm-fix


.PHONY: all lint test
FORCE:
