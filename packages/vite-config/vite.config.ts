import { defineConfig } from "vite-plus";

export default defineConfig({
	test: {
		globals: false,
		passWithNoTests: true,
	},
});
