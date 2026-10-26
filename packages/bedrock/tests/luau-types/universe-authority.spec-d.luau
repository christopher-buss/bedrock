--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Universe identity authority", function()
	t.it("should accept a root identity with metadata-only environment overlays", function()
		local config = bedrock.defineConfig({
			universe = { universeId = "111" },
			environments = { production = { universe = { voiceChatEnabled = true } } },
		})
		t.expectTypeOf(config.universe.universeId):toEqualType<<string>>()
	end)

	t.it("should accept environment identities with shared root metadata", function()
		local config = bedrock.defineConfig({
			universe = { desktopEnabled = true },
			environments = {
				production = { universe = { universeId = "111" } },
				staging = { universe = { universeId = "222" } },
			},
		})
		t.expectTypeOf(config.environments.staging.universe.universeId):toEqualType<<string>>()
	end)

	t.it("should accept no universe blocks or environment-only identities", function()
		local minimal = bedrock.defineConfig({ environments = { production = {} } })
		local environment = bedrock.defineConfig({ environments = { production = { universe = { universeId = "111" } } } })
		t.expectTypeOf(minimal.environments.production):toEqualType<<{}>>()
		t.expectTypeOf(environment.environments.production.universe.universeId):toEqualType<<string>>()
	end)

	t.it("should reject root and environment identities in either environment slot", function()
		-- @expect-error
		local first = bedrock.defineConfig({ universe = { universeId = "111" }, environments = { production = { universe = { universeId = "222" } } } })
		-- @expect-error
		local second = bedrock.defineConfig({ universe = { universeId = "111" }, environments = { production = {}, staging = { universe = { universeId = "222" } } } })
	end)

	t.it("should preserve the TypeScript union's absent-root and present-root distinction", function()
		local noRoot = bedrock.defineConfig({ environments = { production = { universe = { voiceChatEnabled = true } } } })
		t.expectTypeOf(noRoot.environments.production.universe.voiceChatEnabled):toEqualType<<boolean>>()
		-- @expect-error
		local sharedRoot = bedrock.defineConfig({ universe = { desktopEnabled = true }, environments = { production = { universe = { voiceChatEnabled = true } } } })
	end)

	t.it("should check the identities carried by a typed environment map", function()
		type IdentityEnvironment = { universe: { universeId: string } }
		local environments: { [string]: IdentityEnvironment } = { production = { universe = { universeId = "222" } } }
		local value = { environments = environments }
		local valid: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)
		t.expectTypeOf(valid.environments.production.universe.universeId):toEqualType<<string>>()
		-- @expect-error
		local wrong: number = valid.environments.production.universe.universeId
		local conflicting = { universe = { universeId = "111" }, environments = environments }
		-- @expect-error
		local invalid: bedrock.Config<typeof(conflicting)> = bedrock.defineConfig(conflicting)
	end)
end)
