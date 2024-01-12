bench:
	test -n "$(name)"

setup:
	command -v deno || curl -fsSL https://deno.land/install.sh | sh
	command -v bun || curl -fsSL https://bun.sh/install | bash

run:
	test -n "$(name)"
	echo "Running $(name)"
	file=$$(echo "src/$(name).{js,mjs,cjs,jsx,ts,mts,cts,tsx}") \
	cmd=$$(head -n1 "$$file" | cut -c 2-) \
	time $$cmd "$$file"

run-reference:
	time bun reference.ts
