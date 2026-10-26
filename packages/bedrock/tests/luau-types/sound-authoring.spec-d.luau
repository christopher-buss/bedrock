--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Sound config authoring", function()
	t.it("should reject an uncertain root identity", function()
		local function maybeId(): string? return nil end
		local identity = maybeId()
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = identity }, environments = { production = { universe = { voiceChatEnabled = true } } } })
	end)

	t.it("should preserve the required identity on a mutable result", function()
		local config = bedrock.defineConfig({ universe = { universeId = "111" }, environments = { production = { universe = { voiceChatEnabled = true } } } })
		t.expectTypeOf(config.universe.universeId):toEqualType<<string>>()
		-- @expect-error
		config.universe.universeId = nil
	end)

	t.it("should accept a semantically nil-only identity intersection", function()
		type Overlay = bedrock.UniverseEntry & { universeId: never? }
		type Value = { universe: { universeId: string }, environments: { production: { universe: Overlay } } }
		t.expectType<<bedrock.Config<Value>>>():toExtend<<Value>>()
	end)

	t.it("should reject unknown keys before an entry annotation erases them", function()
		-- @expect-error
		local pass: bedrock.GamePassEntry = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, typo = true }
	end)

	t.it("should check environment annotations against their actual entries", function()
		local value = { passes = { vip = { price = bedrock.none } } }
		local valid: bedrock.EnvironmentEntry<typeof(value)> = bedrock.defineEnvironment(value)
		t.expectTypeOf(valid.passes.vip.price):toEqualType<<bedrock.None>>()
		-- @expect-error
		type Unchecked = bedrock.EnvironmentEntry
		-- @expect-error
		type Invalid = bedrock.EnvironmentEntry<{ passes: { vip: { price: string } } }>
	end)

	t.it("should reject undeclared constituent and locale fields", function()
		-- @expect-error
		local product: bedrock.DeveloperProductEntry = { name = "Gems", description = "Pack", prise = 100 }
		-- @expect-error
		local place: bedrock.PlaceEntry = { displayname = "Lobby" }
		-- @expect-error
		local overlay: bedrock.GamePassOverlay = { prise = 100 }
		-- @expect-error
		local redaction: bedrock.RedactedGamePassOverride = { prise = 100 }
		-- @expect-error
		local pass: bedrock.GamePassEntry = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png", typo = "bad.png" } }
	end)

	t.it("should reject extra initializer keys on explicitly checked annotations", function()
		type Good = { environments: { production: {} } }
		-- @expect-error
		local config: bedrock.Config<Good> = { environments = { production = {} }, badges = {} }
		-- @expect-error
		local environment: bedrock.EnvironmentEntry<{ label: string }> = { label = "Production", typo = true }
	end)

	t.it("should require checked factories even for otherwise valid raw initializers", function()
		type Good = { environments: { production: {} } }
		-- @expect-error
		local config: bedrock.Config<Good> = { environments = { production = {} } }
		-- @expect-error
		local environment: bedrock.EnvironmentEntry<{ label: string }> = { label = "Production" }
		-- @expect-error
		local forged: bedrock.Config<Good> = { environments = { production = {} }, __bedrockConfig = true }
	end)

	t.it("should check factory input before a result annotation can hide optional map values", function()
		type Overlay = { passes: { [string]: bedrock.GamePassOverlay }? }
		-- @expect-error
		local environment: bedrock.EnvironmentEntry<Overlay> = bedrock.defineEnvironment({ passes = { vip = { price = "100" } } })
		-- @expect-error
		local config: bedrock.Config<{ environments: { production: Overlay } }> = bedrock.defineConfig({ environments = { production = { passes = { vip = { price = "100" } } } } })
	end)

	t.it("should preserve healthy map field types without erasing the whole checked value", function()
		type Entry = { universe: { universeId: string } }
		local environments: { [string]: Entry } = { production = { universe = { universeId = "111" } } }
		local config = bedrock.defineConfig({ environments = environments })
		t.expectTypeOf(config.environments.production.universe.universeId):toEqualType<<string>>()
		-- @expect-error
		local field: number = config.environments.production.universe.universeId
		-- @expect-error
		local whole: number = config
		-- @expect-error
		local text: string = config
	end)

	t.it("should allow revalidation of factory results without runtime proof fields", function()
		local environment = bedrock.defineEnvironment({ passes = { vip = { price = bedrock.none } } })
		local config = bedrock.defineConfig({ environments = { production = environment } })
		local checked = bedrock.defineConfig(config)
		t.expectTypeOf(checked.environments.production.passes.vip.price):toEqualType<<bedrock.None>>()
	end)
end)
