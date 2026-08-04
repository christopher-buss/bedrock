import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig(async () => {
	// The fixture exists to prove the loader awaits an async config factory, so
	// the await stays even though nothing here is genuinely asynchronous.
	await Promise.resolve();
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
	};
});
