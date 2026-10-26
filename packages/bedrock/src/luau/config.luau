--!strict
-- Types for authoring `bedrock.config.luau`. Written by `bedrock setup`;
-- do not edit it; rerun `bedrock setup` after upgrading bedrock.

export type None = "$none"
local none: None = "$none"
local gistBackend: "gist" = "gist"

-- Replacement values for a redacted game pass. Each field replaces the
-- matching bedrock placeholder; omitted fields keep the placeholder.
export type RedactedGamePassOverride = {
	[string]: never,
	name: string?,
	description: string?,
	icon: { ["en-us"]: string, [string]: never }?,
	price: number?,
}

-- Replacement values for a redacted developer product.
export type RedactedDeveloperProductOverride = {
	[string]: never,
	name: string?,
	description: string?,
	icon: { ["en-us"]: string, [string]: never }?,
	price: number?,
}

-- Body of a single entry in the `products` collection.
export type DeveloperProductEntry = {
	[string]: never,
	name: string,
	description: string,
	icon: { ["en-us"]: string, [string]: never }?,
	price: (number | "$none")?,
	redacted: (boolean | RedactedDeveloperProductOverride)?,
}

-- Replacement values for a redacted place. An omitted displayName keeps
-- the real name; an omitted description uses the placeholder.
export type RedactedPlaceOverride = {
	[string]: never,
	description: string?,
	displayName: string?,
}

-- Body of a root `places` entry. The environment supplies placeId.
export type PlaceEntry = {
	[string]: never,
	description: string?,
	displayName: string?,
	filePath: string?,
	redacted: (boolean | RedactedPlaceOverride)?,
	serverSize: number?,
}

-- Display title and destination of a universe social link.
export type SocialLink = { title: string, uri: string, [string]: never }

-- Singleton universe settings. Omitted fields remain unmanaged;
-- "$none" clears a social link or disables private servers.
export type UniverseEntry = {
	[string]: never,
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
	[string]: never,
	-- Name shown on the Roblox storefront.
	name: string,
	-- Description shown on the game-pass detail page.
	description: string,
	-- Locale-keyed icon path. Only the "en-us" key is accepted.
	icon: { ["en-us"]: string, [string]: never },
	-- Robux price. Omit it or write "$none" for an off-sale pass.
	price: (number | "$none")?,
	-- Set to `true` to deploy this pass with bedrock placeholder content, or
	-- to an override to replace selected placeholders.
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Per-environment override of a `passes` entry; every field is optional.
export type GamePassOverlay = {
	[string]: never,
	name: string?,
	description: string?,
	icon: { ["en-us"]: string, [string]: never }?,
	-- "$none" turns off a price the root entry declares.
	price: (number | "$none")?,
	redacted: (boolean | RedactedGamePassOverride)?,
}

-- Per-environment product settings; every field falls through to the root.
export type DeveloperProductOverlay = {
	[string]: never,
	name: string?,
	description: string?,
	icon: { ["en-us"]: string, [string]: never }?,
	price: (number | "$none")?,
	redacted: (boolean | RedactedDeveloperProductOverride)?,
}

-- A place overlay keeps the environment-specific identity required.
export type PlaceOverlay = {
	[string]: never,
	placeId: string,
	description: string?,
	displayName: string?,
	filePath: string?,
	redacted: (boolean | RedactedPlaceOverride)?,
	serverSize: number?,
}

-- Shared redaction values projected onto each applicable resource kind.
export type RedactedEnvironmentOverride = {
	[string]: never,
	name: string?,
	description: string?,
	displayName: string?,
	icon: { ["en-us"]: string, [string]: never }?,
	price: number?,
}

export type GistStateConfig = {
	[string]: never,
	read backend: "gist",
	read gistId: string,
	read locking: boolean?,
}

-- The literal member retains backend tags on direct state annotations.
export type PluginStateConfig = {
	read backend: string | "gist",
	read locking: boolean?,
	[string]: unknown,
}

export type StateConfig = GistStateConfig | PluginStateConfig

-- Body of a single entry under `environments`.
type EnvironmentShape = {
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
type ConfigShape = {
	codegen: { enabled: boolean?, output: string?, typeDeclarations: boolean? }?,
	displayNamePrefix: { enabled: boolean?, format: string? }?,
	-- Deployment targets, by environment name.
	environments: { [string]: EnvironmentShape },
	extends: unknown,
	-- Game passes, by resource key.
	passes: { [string]: GamePassEntry }?,
	places: { [string]: PlaceEntry }?,
	plugins: { string }?,
	products: { [string]: DeveloperProductEntry }?,
	state: StateConfig?,
	universe: UniverseEntry?,
}

type function TableShape(value: type): type
	if not value:is("intersection") then return value end
	local result = types.newtable()
	local tables = false
	for _, part in value:components() do
		local member = TableShape(part)
		if member:is("any") then return types.any end
		if member:is("table") then
			tables = true
			for key, property in member:properties() do
				if property.read then
					local existing = result:readproperty(key)
					result:setreadproperty(key, if existing then types.intersectionof(existing, property.read) else property.read)
				end
			end
			local indexer = member:indexer()
			if indexer then
				local existing = result:indexer()
				if existing then
					result:setindexer(types.unionof(existing.index, indexer.index), types.intersectionof(existing.readresult, indexer.readresult))
				else
					result:setindexer(indexer.index, indexer.readresult)
				end
			end
		elseif not member:is("unknown") then
			return value
		end
	end
	return if tables then result else value
end

type function CheckedConfig(actual: type, expected: type, authored: type, builtinState: type)
	local check: (type, type, string, type?) -> string?
	check = function(value: type, schema: type, path: string, stateSchema: type?): string?
		value = TableShape(value)
		if schema:is("unknown") or schema:is("any") or value:is("any") then
			return nil
		elseif value:is("union") then
			for _, member in value:components() do
				local issue = check(member, schema, path, stateSchema)
				if issue then
					return issue
				end
			end
			return nil
		elseif schema:is("union") then
			local tableIssue: string? = nil
			for _, member in schema:components() do
				local issue = check(value, member, path, stateSchema)
				if not issue then
					return nil
				elseif member:is("table") then
					tableIssue = issue
				end
			end
			return tableIssue or path .. " has an invalid type"
		elseif value:is("table") and schema:is("table") then
			local selectedState = stateSchema
			if authored:value() and path == "config" then
				local plugins = value:readproperty(types.singleton("plugins"))
				if not plugins or plugins:is("nil") or (plugins:is("table") and not plugins:indexer()) then
					selectedState = types.unionof(builtinState, types.singleton(nil))
				end
			end
			local expectedIndexer = schema:indexer()
			for key, property in value:properties() do
				local privateProof = key:value() == "__bedrockConfig" or key:value() == "__bedrockEnvironment"
				if privateProof and property.read and property.read:issubtypeof(types.never) then continue end
				local target = schema:readproperty(key)
				local fieldPath = path .. "." .. tostring(key:value())
				if target and selectedState and key:value() == "state" then
					target = selectedState
				end
				if not target then
					if not expectedIndexer or not key:issubtypeof(expectedIndexer.index) then
						return fieldPath .. " is not a declared field"
					end
					target = expectedIndexer.readresult
				end
				if target and property.read then
					local issue = check(property.read, target, fieldPath, selectedState)
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
				return check(actualIndexer.readresult, expectedIndexer.readresult, path .. "[*]", selectedState)
			end
			return nil
		elseif value:issubtypeof(schema) then
			return nil
		end
		return path .. " has an invalid type"
	end
	local issue = check(actual, expected, "config", nil)
	if issue then
		error(issue)
	end
	local variants: (type) -> { type }
	variants = function(value: type): { type }
		value = TableShape(value)
		if value:is("union") then
			local result: { type } = {}
			for _, member in value:components() do
				for _, variant in variants(member) do
					table.insert(result, variant)
				end
			end
			return result
		end
		return { value }
	end
	local function checkEnvironment(environment: type, rootAuthority: boolean, path: string): string?
		for _, variant in variants(environment) do
			if variant:is("table") then
				local universe = variant:readproperty(types.singleton("universe"))
				if universe then
					for _, overlay in variants(universe) do
						if overlay:is("table") then
							local identity = overlay:readproperty(types.singleton("universeId"))
							local hasIdentity = identity ~= nil and not identity:issubtypeof(types.singleton(nil))
							if rootAuthority and hasIdentity then
								return path .. ".universe.universeId is already declared at the root"
							elseif not rootAuthority then
								if not hasIdentity or (identity and types.singleton(nil):issubtypeof(identity)) then
									return path .. ".universe.universeId is required without a root identity"
								end
							end
						end
					end
				end
			end
		end
		return nil
	end
	local function checkEnvironments(environments: type, rootAuthority: boolean): string?
		for _, environmentMap in variants(environments) do
			if environmentMap:is("table") then
				for key, property in environmentMap:properties() do
					if property.read then
						local issue = checkEnvironment(property.read, rootAuthority, "config.environments." .. tostring(key:value()))
						if issue then return issue end
					end
				end
				local indexer = environmentMap:indexer()
				if indexer then
					local issue = checkEnvironment(indexer.readresult, rootAuthority, "config.environments[*]")
					if issue then return issue end
				end
			end
		end
		return nil
	end
	for _, config in variants(actual) do
		if config:is("table") then
			local root = config:readproperty(types.singleton("universe")) or types.singleton(nil)
			local environments = config:readproperty(types.singleton("environments"))
			if environments then
				for _, rootVariant in variants(root) do
					local issue: string? = nil
					if rootVariant:is("table") then
						local identity = rootVariant:readproperty(types.singleton("universeId"))
						local rootAuthority = identity ~= nil and not identity:issubtypeof(types.singleton(nil))
						if rootAuthority and identity and types.singleton(nil):issubtypeof(identity) then
							issue = "config.universe.universeId must have a definite identity"
						else
							issue = checkEnvironments(environments, rootAuthority)
						end
					elseif rootVariant:is("nil") then
						issue = checkEnvironments(environments, true)
						if issue then issue = checkEnvironments(environments, false) end
					end
					if issue then error(issue) end
				end
			end
		end
	end
	return types.unknown
end

-- These proof fields exist only in types; checked factories add no runtime keys.
type ConfigProof = { read __bedrockConfig: never }
type EnvironmentProof = { read __bedrockEnvironment: never }

-- Check an environment without losing its declared resource entry types.
export type EnvironmentEntry<Actual> = Actual & EnvironmentProof & CheckedConfig<Actual, EnvironmentShape, false, GistStateConfig>

-- Check an existing table without replacing its declared property types.
-- Use `local checked: Config<typeof(value)> = defineConfig(value)`.
export type Config<Actual> = Actual & ConfigProof & CheckedConfig<Actual, ConfigShape, false, GistStateConfig>

-- Returns the original config; validation runs only during type analysis.
local function defineConfig<T>(config: T & CheckedConfig<T, ConfigShape, true, GistStateConfig>): T & ConfigProof
	-- The argument guard checks the original value. Luau cannot construct the
	-- impossible proof field; this result-only assertion adds no runtime key.
	return (config :: any) :: T & ConfigProof
end

local function defineEnvironment<T>(environment: T & CheckedConfig<T, EnvironmentShape, false, GistStateConfig>): T & EnvironmentProof
	-- The argument guard checks the original value. Luau cannot construct the
	-- impossible proof field; this result-only assertion adds no runtime key.
	return (environment :: any) :: T & EnvironmentProof
end

return {
	defineConfig = defineConfig,
	defineEnvironment = defineEnvironment,
	none = none,
	gistBackend = gistBackend,
}
