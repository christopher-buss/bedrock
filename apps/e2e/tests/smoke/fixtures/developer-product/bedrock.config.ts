import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: { smoke: {} },
	products: {
		"smoke-product": {
			// Roblox refuses a product whose name another product in the
			// universe already holds, and Open Cloud v2 has no DELETE, so a
			// name spent on a product this suite lost track of is spent for
			// good. Renaming here is how a run recovers from that.
			name: "Bedrock Smoke Product",
			description: "Synthetic developer product exercised by the e2e smoke suite.",
			icon: { "en-us": "icon.png" },
			price: 100,
		},
	},
});
