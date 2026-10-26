--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

type Minimal = { environments: { production: {} } }
type Config = bedrock.Config<Minimal>

t.describe("Config", function()
	t.it("should accept a minimal config", function()
		local config = bedrock.defineConfig({ environments = { production = {} } })

		t.expectTypeOf(config.environments.production):toEqualType<<{}>>()
		local annotated: Config = bedrock.defineConfig({ environments = { production = {} } })
		t.expectTypeOf(annotated):toEqualType<<Config>>()
	end)
end)
