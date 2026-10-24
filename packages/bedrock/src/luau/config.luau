--!strict
-- Types for authoring `bedrock.config.luau`. Written by `bedrock setup`;
-- rerun it after upgrading bedrock instead of editing this file.

-- Body of a single entry in the `passes` collection.
export type GamePassEntry = {
	-- Name shown on the Roblox storefront.
	name: string,
	-- Description shown on the game-pass detail page.
	description: string,
	-- Locale-keyed icon path. Only the "en-us" key is accepted.
	icon: { ["en-us"]: string },
	-- Robux price. Omit it for an off-sale pass.
	price: number?,
	-- Set to `true` to deploy this pass with bedrock-supplied placeholder content.
	redacted: boolean?,
}

-- Per-environment override of a `passes` entry; every field is optional.
export type GamePassOverlay = {
	name: string?,
	description: string?,
	icon: { ["en-us"]: string }?,
	price: number?,
	redacted: boolean?,
}

-- Body of a single entry under `environments`.
export type EnvironmentEntry = {
	-- Per-environment overrides of root `passes` entries, by key.
	passes: { [string]: GamePassOverlay }?,
}

-- A bedrock project config.
export type Config = {
	-- Deployment targets, by environment name.
	environments: { [string]: EnvironmentEntry },
	-- Game passes, by resource key.
	passes: { [string]: GamePassEntry }?,
}

-- Returns `config` unchanged, typed as a `Config` so editors check and
-- complete it.
local function defineConfig(config: Config): Config
	return config
end

return {
	defineConfig = defineConfig,
}
