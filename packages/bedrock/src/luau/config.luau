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

-- A read-only contextual shape preserves literals without requiring mutable
-- resource entries to be invariant with the complete schema.
type function ConfigContext(schema)
	local visit: (type) -> type
	visit = function(value: type): type
		if value:is("table") then
			local result = types.newtable()
			for key, property in value:properties() do
				if property.read then
					result:setreadproperty(key, visit(property.read))
				end
			end
			local indexer = value:indexer()
			if indexer then
				result:setindexer(indexer.index, visit(indexer.readresult))
			end
			return result
		elseif value:is("union") then
			local members = value:components()
			for index, member in members do
				members[index] = visit(member)
			end
			return types.unionof(table.unpack(members))
		end
		return value
	end
	return visit(schema)
end

type function CheckedConfig(actual, expected)
	local check: (type, type, string) -> string?
	check = function(value: type, schema: type, path: string): string?
		if schema:is("unknown") or schema:is("any") or value:is("any") then
			return nil
		elseif value:is("union") then
			for _, member in value:components() do
				local issue = check(member, schema, path)
				if issue then
					return issue
				end
			end
			return nil
		elseif schema:is("union") then
			local tableIssue: string? = nil
			for _, member in schema:components() do
				local issue = check(value, member, path)
				if not issue then
					return nil
				elseif member:is("table") then
					tableIssue = issue
				end
			end
			return tableIssue or path .. " has an invalid type"
		elseif value:is("table") and schema:is("table") then
			local expectedIndexer = schema:indexer()
			for key, property in value:properties() do
				local target = schema:readproperty(key)
				local fieldPath = path .. "." .. tostring(key:value())
				if not target then
					if not expectedIndexer or not key:issubtypeof(expectedIndexer.index) then
						return fieldPath .. " is not a declared field"
					end
					target = expectedIndexer.readresult
				end
				if target and property.read then
					local issue = check(property.read, target, fieldPath)
					if issue then
						return issue
					end
				end
			end
			for key, property in schema:properties() do
				if property.read and not value:readproperty(key) and not types.singleton(nil):issubtypeof(property.read) then
					return path .. "." .. tostring(key:value()) .. " is required"
				end
			end
			local actualIndexer = value:indexer()
			if actualIndexer then
				if not expectedIndexer or not actualIndexer.index:issubtypeof(expectedIndexer.index) then
					return path .. " has an invalid collection key type"
				end
				return check(actualIndexer.readresult, expectedIndexer.readresult, path .. "[*]")
			end
			return nil
		elseif value:issubtypeof(schema) then
			return nil
		end
		return path .. " has an invalid type"
	end
	local issue = check(actual, expected, "config")
	if issue then
		error(issue)
	end
	return actual
end

-- Returns the original config; validation runs only during type analysis.
local function defineConfig<T>(config: T & ConfigContext<Config> & CheckedConfig<T, Config>): T
	return config
end

return {
	defineConfig = defineConfig,
}
