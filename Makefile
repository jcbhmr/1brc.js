bench:
	test -n "$(name)"

setup:
	command -v deno || curl -fsSL https://deno.land/install.sh | sh
	command -v bun || curl -fsSL https://bun.sh/install | bash

run:
	test -n "$(name)"
	echo "Running $(name)"
	file="src/$(name).js" ;\
	test -f "$$file" || file="src/$(name).ts" ;\
	cmd=$$(head -n1 "$$file" | cut -c 3-) ;\
	time $$cmd "$$file" "measurements.txt"

run-reference:
	time bun reference.ts
