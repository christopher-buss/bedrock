import { defineConfig } from "@bedrock/core";

export default defineConfig({
	environments: { production: {} },
	universe: {
		desktopEnabled: false,
		discordSocialLink: { title: "Join our Discord", uri: "https://discord.gg/example" },
		twitterSocialLink: undefined,
		universeId: "1234567890",
		voiceChatEnabled: true,
	},
});
