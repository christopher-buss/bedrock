--!strict
-- Types for authoring `bedrock.config.luau`. Written by `bedrock setup`;
-- do not edit it; rerun `bedrock setup` after upgrading bedrock.

-- Replacement values for a redacted game pass. Each field replaces the
-- matching bedrock placeholder; omitted fields keep the placeholder.
export type RedactedGamePassOverride = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	price: number?,
}

-- Replacement values for a redacted developer product.
export type RedactedDeveloperProductOverride = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	price: number?,
}

-- Body of a single entry in the `products` collection.
export type DeveloperProductEntry = {
	name: string,
	description: string,
	icon: { ["en-us"]: string }?,
	price: (number | "$none")?,
	redacted: (boolean | RedactedDeveloperProductOverride)?,
}

-- Replacement values for a redacted place. An omitted displayName keeps
-- the real name; an omitted description uses the placeholder.
export type RedactedPlaceOverride = {
	description: string?,
	displayName: string?,
}

-- Body of a root `places` entry. The environment supplies placeId.
export type PlaceEntry = {
	description: string?,
	displayName: string?,
	filePath: string?,
	redacted: (boolean | RedactedPlaceOverride)?,
	serverSize: number?,
}

-- Display title and destination of a universe social link.
export type SocialLink = { title: string, uri: string }

-- Singleton universe settings. Omitted fields remain unmanaged;
-- "$none" clears a social link or disables private servers.
export type UniverseEntry = {
	consoleEnabled: boolean?,
	desktopEnabled: boolean?,
	discordSocialLink: (SocialLink | "$none")?,
	displayName: string?,
	facebookSocialLink: (SocialLink | "$none")?,
	guildedSocialLink: (SocialLink | "$none")?,
	mobileEnabled: boolean?,
	privateServerPriceRobux: (number | "$none")?,
	robloxGroupSocialLink: (SocialLink | "$none")?,
	tabletEnabled: boolean?,
	twitchSocialLink: (SocialLink | "$none")?,
	twitterSocialLink: (SocialLink | "$none")?,
	universeId: string?,
	voiceChatEnabled: boolean?,
	vrEnabled: boolean?,
	youtubeSocialLink: (SocialLink | "$none")?,
}

-- Body of a single entry in the `passes` collection.
export type GamePassEntry = {
	-- Name shown on the Roblox storefront.
	name: string,
	-- Description shown on the game-pass detail page.
	description: string,
	-- Locale-keyed icon path. Only the "en-us" key is accepted.
	icon: { ["en-us"]: string },
	-- Robux price. Omit it or write "$none" for an off-sale pass.
	price: (number | "$none")?,
	-- Set to `true` to deploy this pass with bedrock placeholder content, or
	-- to an override to replace selected placeholders.
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Per-environment override of a `passes` entry; every field is optional.
export type GamePassOverlay = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	-- "$none" turns off a price the root entry declares.
	price: (number | "$none")?,
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Per-environment product settings; every field falls through to the root.
export type DeveloperProductOverlay = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	price: (number | "$none")?,
	redacted: (boolean | RedactedDeveloperProductOverride)?,
}

-- A place overlay keeps the environment-specific identity required.
export type PlaceOverlay = {
	placeId: string,
	description: string?,
	displayName: string?,
	filePath: string?,
	redacted: (boolean | RedactedPlaceOverride)?,
	serverSize: number?,
}

-- Shared redaction values projected onto each applicable resource kind.
export type RedactedEnvironmentOverride = {
	name: string?,
	description: string?,
	displayName: string?,
	icon: { ["en-us"]: string }?,
	price: number?,
}

-- Backend-specific keys are validated by the selected plugin at load time.
export type StateConfig = {
	backend: string,
	locking: boolean?,
	[string]: unknown,
}

-- Body of a single entry under `environments`.
export type EnvironmentEntry = {
	label: string?,
	-- Per-environment overrides of root `passes` entries, by key.
	passes: { [string]: GamePassOverlay }?,
	places: { [string]: PlaceOverlay }?,
	products: { [string]: DeveloperProductOverlay }?,
	redacted: (boolean | RedactedEnvironmentOverride)?,
	state: StateConfig?,
	universe: UniverseEntry?,
}

-- A bedrock project config.
export type Config = {
	codegen: { enabled: boolean?, output: string?, typeDeclarations: boolean? }?,
	displayNamePrefix: { enabled: boolean?, format: string? }?,
	-- Deployment targets, by environment name.
	environments: { [string]: EnvironmentEntry },
	extends: unknown,
	-- Game passes, by resource key.
	passes: { [string]: GamePassEntry }?,
	places: { [string]: PlaceEntry }?,
	plugins: { string }?,
	products: { [string]: DeveloperProductEntry }?,
	state: StateConfig?,
	universe: UniverseEntry?,
}

-- Returns `config` unchanged, typed as a `Config` so editors check and
-- complete it.
local function defineConfig(config: Config): Config
	return config
end

return {
	defineConfig = defineConfig,
}
