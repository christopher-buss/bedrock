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
	-- Managed pricing defaults to off and requires a price when enabled.
	isManagedPricingEnabled: boolean?,
	-- Set to `true` to deploy this pass with bedrock placeholder content, or
	-- to an override to replace selected placeholders.
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Per-environment override of a `passes` entry; every field is optional.
export type GamePassOverlay = {
	isManagedPricingEnabled: boolean?,
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	-- "$none" turns off a price the root entry declares.
	price: (number | "$none")?,
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Products accept the same pricing and redaction fields; icons are optional.
export type DeveloperProductEntry = {
	name: string,
	description: string,
	icon: { ["en-us"]: string }?,
	price: (number | "$none")?,
	isManagedPricingEnabled: boolean?,
	redacted: (boolean | RedactedGamePassOverride)?,
}

export type DeveloperProductOverlay = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	price: (number | "$none")?,
	isManagedPricingEnabled: boolean?,
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Body of a single entry under `environments`.
export type EnvironmentEntry = {
	-- Per-environment overrides of root `passes` entries, by key.
	passes: { [string]: GamePassOverlay }?,
	products: { [string]: DeveloperProductOverlay }?,
}

-- A bedrock project config.
export type Config = {
	-- Deployment targets, by environment name.
	environments: { [string]: EnvironmentEntry },
	-- Game passes, by resource key.
	passes: { [string]: GamePassEntry }?,
	products: { [string]: DeveloperProductEntry }?,
}

-- Returns `config` unchanged, typed as a `Config` so editors check and
-- complete it.
local function defineConfig(config: Config): Config
	return config
end

return {
	defineConfig = defineConfig,
}
