--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Authored universe visibility", function()
	t.it("should accept a literal visibility on the root universe", function()
		local config = bedrock.defineConfig({ universe = { universeId = "111", visibility = "private" }, environments = { production = {} } })
		t.expectTypeOf(config.universe.visibility):toEqualType<<"private">>()
		local environment = bedrock.defineEnvironment({ universe = { visibility = "public" } })
		t.expectTypeOf(environment.universe.visibility):toEqualType<<"public">>()
	end)

	t.it("should reject a visibility outside public and private", function()
		-- @expect-error
		local root = bedrock.defineConfig({ environments = { production = {} }, universe = { visibility = "unlisted" } })
		-- @expect-error
		local environment = bedrock.defineEnvironment({ universe = { visibility = "unlisted" } })
	end)
end)
