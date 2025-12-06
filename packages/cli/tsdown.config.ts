import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: ["src/index.ts"],
	fixedExtension: true,
	format: ["esm"],
	publint: true,
	shims: true,
	unused: { level: "error" },
});
