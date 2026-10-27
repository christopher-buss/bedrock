--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Universe visibility authoring", function()
	t.it("should accept public and private visibility at the root and in environments", function()
		local publicVisibility: "public" = "public"
		local privateVisibility: "private" = "private"
		local public = bedrock.defineConfig({
			universe = { universeId = "123", visibility = publicVisibility },
			environments = { production = { universe = { visibility = privateVisibility } } },
		})
		local private = bedrock.defineConfig({
			universe = { universeId = "123", visibility = privateVisibility },
			environments = { production = { universe = { visibility = publicVisibility } } },
		})
		t.expectTypeOf(public.universe.visibility):toEqualType<<"public">>()
		t.expectTypeOf(public.environments.production.universe.visibility):toEqualType<<"private">>()
		t.expectTypeOf(private.universe.visibility):toEqualType<<"private">>()
		t.expectTypeOf(private.environments.production.universe.visibility):toEqualType<<"public">>()
	end)

	t.it("should accept omitted root and environment visibility", function()
		local config = bedrock.defineConfig({
			universe = { universeId = "123" },
			environments = { production = { universe = { displayName = "Production" } } },
		})
		t.expectTypeOf(config.universe.universeId):toEqualType<<string>>()
	end)

	t.it("should reject unsupported root visibility strings", function()
		local visibility: "friends" = "friends"
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123", visibility = visibility }, environments = { production = {} } })
	end)

	t.it("should reject boolean root visibility", function()
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123", visibility = true }, environments = { production = {} } })
	end)

	t.it("should reject none as root visibility", function()
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123", visibility = bedrock.none }, environments = { production = {} } })
	end)

	t.it("should reject unsupported environment visibility strings", function()
		local visibility: "friends" = "friends"
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123" }, environments = { production = { universe = { visibility = visibility } } } })
	end)

	t.it("should reject boolean environment visibility", function()
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123" }, environments = { production = { universe = { visibility = true } } } })
	end)

	t.it("should reject none as environment visibility", function()
		-- @expect-error
		local config = bedrock.defineConfig({ universe = { universeId = "123" }, environments = { production = { universe = { visibility = bedrock.none } } } })
	end)
end)
