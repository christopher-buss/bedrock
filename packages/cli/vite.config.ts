import { defineConfig } from "vite-plus";

export default defineConfig({
	pack: {
		clean: true,
		dts: true,
		entry: ["src/index.ts"],
		fixedExtension: true,
		format: ["esm"],
		publint: true,
		shims: true,
		sourcemap: true,
		tsconfig: "tsconfig.build.json",
		unused: { level: "error" },
	},
});
