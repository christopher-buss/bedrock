import { defineConfig, mergeCatalogRules } from "pncat";

export default defineConfig({
	catalogRules: mergeCatalogRules([]),
	postRun: 'eslint --fix "**/pnpm-workspace.yaml" "**/package.json"',
});
