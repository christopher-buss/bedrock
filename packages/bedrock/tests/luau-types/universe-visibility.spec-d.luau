--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Authored universe visibility", function()
	t.it("should accept the visibility constants on the root and environment universe", function()
		local config = bedrock.defineConfig({ universe = { universeId = "111", visibility = bedrock.privateVisibility }, environments = { production = { universe = { visibility = bedrock.publicVisibility } } } })
		t.expectTypeOf(config.universe.visibility):toEqualType<<"private">>()
		t.expectTypeOf(config.environments.production.universe.visibility):toEqualType<<"public">>()
		local environment = bedrock.defineEnvironment({ universe = { visibility = bedrock.privateVisibility } })
		t.expectTypeOf(environment.universe.visibility):toEqualType<<"private">>()
	end)

	t.it("should reject a visibility outside public and private", function()
		-- @expect-error
		local root = bedrock.defineConfig({ environments = { production = {} }, universe = { visibility = "unlisted" } })
		-- @expect-error
		local environment = bedrock.defineEnvironment({ universe = { visibility = "unlisted" } })
	end)
end)
