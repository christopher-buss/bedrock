--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Explicit checked config types", function()
	t.it("should require the actual shape rather than expose an unchecked Config annotation", function()
		-- @expect-error
		type Unchecked = bedrock.Config
	end)

	t.it("should preserve mutable resource fields in an already typed collection", function()
		local passes: { [string]: bedrock.GamePassEntry } = {
			vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" } },
		}
		local value = { environments = { production = {} }, passes = passes }
		local checked: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)
		checked.passes.vip.price = 100
		checked.passes.vip.price = bedrock.none
		checked.passes.vip.name = "Updated"
		t.expectTypeOf(checked.passes.vip.name):toEqualType<<string>>()
		-- @expect-error
		checked.passes.vip.price = "100"
	end)

	t.it("should check wrong-typed entries in a typed dictionary", function()
		type WrongPass = { name: string, description: string, icon: { ["en-us"]: string }, price: string }
		local passes: { [string]: WrongPass } = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = "100" } }
		local value = { environments = { production = {} }, passes = passes }
		-- @expect-error
		local checked: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)
	end)

	t.it("should reject unknown fields on existing config values", function()
		local value = { environments = { production = {} }, gadgets = {} }
		-- @expect-error
		local checked: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)
	end)

	t.it("should accept each valid member of a config union", function()
		type Root = { universe: { universeId: string }, environments: { production: {} } }
		type Environment = { environments: { production: { universe: { universeId: string } } } }
		type Value = Root | Environment
		t.expectType<<bedrock.Config<Value>>>():toExtend<<Value>>()
		local function validate(value: Value): bedrock.Config<Value>
			return bedrock.defineConfig(value)
		end
		t.expectTypeOf(validate):toExtend<<(Value) -> Value>>()
	end)

	t.it("should reject a union containing an invalid config member", function()
		type Valid = { environments: { production: {} } }
		type Invalid = { universe: { universeId: string }, environments: { production: { universe: { universeId: string } } } }
		-- @expect-error
		type Checked = bedrock.Config<Valid | Invalid>
	end)

	t.it("should inspect real environment indexers alongside named overrides", function()
		type Environment = { universe: { universeId: string } }
		local environments: { [string]: Environment, production: {} } = { production = {}, staging = { universe = { universeId = "222" } } }
		local value = { universe = { universeId = "111" }, environments = environments }
		-- @expect-error
		local checked: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)
		-- @expect-error
		local inline = bedrock.defineConfig({ universe = { universeId = "111" }, environments = environments })
	end)

	t.it("should inspect config intersections rather than skip identity validation", function()
		type Root = { universe: { universeId: string } }
		type Environments = { environments: { production: { universe: { universeId: string } } } }
		-- @expect-error
		type Checked = bedrock.Config<Root & Environments>
	end)

	t.it("should preserve valid config intersections", function()
		type Root = { universe: { universeId: string } }
		type Environments = { environments: { production: {} } }
		type Value = Root & Environments
		t.expectType<<bedrock.Config<Value>>>():toExtend<<Value>>()
	end)

	t.it("should expose the typed clearing sentinel", function()
		t.expectType<<bedrock.None>>():toEqualType<<"$none">>()
		t.expectTypeOf(bedrock.none):toEqualType<<bedrock.None>>()
	end)

	t.it("should treat nil as omission while retaining the explicit clearing sentinel", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = nil } }, products = nil })
		t.expectTypeOf(config.passes.vip.name):toEqualType<<string>>()
		-- @expect-error
		local invalid = bedrock.defineConfig({ environments = { production = {} }, universe = { voiceChatEnabled = bedrock.none } })
	end)

	t.it("should accept a literal clearing sentinel on the root universe", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, universe = { privateServerPriceRobux = "$none", twitchSocialLink = "$none" } })
		t.expectTypeOf(config.universe.privateServerPriceRobux):toEqualType<<"$none">>()
		t.expectTypeOf(config.universe.twitchSocialLink):toEqualType<<"$none">>()
	end)
end)
