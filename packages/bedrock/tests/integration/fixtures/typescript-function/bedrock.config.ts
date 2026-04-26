import { defineConfig } from "@bedrock/core";

export default defineConfig(async () => {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				iconFilePath: "assets/vip-icon.png",
				price: 500,
			},
		},
	};
});
