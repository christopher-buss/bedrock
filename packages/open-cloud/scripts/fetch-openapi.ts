const response = await fetch(
	"https://raw.githubusercontent.com/Roblox/creator-docs/refs/heads/main/content/en-us/reference/cloud/openapi.json",
);
await Bun.write("vendor/roblox-openapi.json", response);
