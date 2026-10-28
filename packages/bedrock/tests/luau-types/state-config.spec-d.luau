--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Authored state configuration", function()
	t.it("should expose the built-in state coordinates", function()
		type Expected = { read backend: "gist", read gistId: string, read locking: boolean?, [string]: never }
		t.expectType<<bedrock.GistStateConfig>>():toEqualType<<Expected>>()
	end)

	t.it("should select the built-in backend when no plugins are listed", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, state = { backend = bedrock.gistBackend, gistId = "abc", locking = false } })
		t.expectTypeOf(config.state.backend):toEqualType<<"gist">>()
		t.expectTypeOf(config.state.gistId):toEqualType<<string>>()
	end)

	t.it("should accept a literal built-in backend at the root and in a checked environment", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, state = { backend = "gist", gistId = "abc" } })
		t.expectTypeOf(config.state.backend):toEqualType<<"gist">>()
		local environment = bedrock.defineEnvironment({ state = { backend = "gist", gistId = "abc" } })
		t.expectTypeOf(environment.state.backend):toEqualType<<"gist">>()
	end)

	t.it("should reject unknown backends, missing coordinates and undeclared state keys without plugins", function()
		-- @expect-error
		local backend = bedrock.defineConfig({ environments = { production = {} }, state = { backend = "s3", bucket = "my-bucket" } })
		-- @expect-error
		local coordinate = bedrock.defineConfig({ environments = { production = {} }, state = { backend = bedrock.gistBackend } })
		-- @expect-error
		local key = bedrock.defineConfig({ environments = { production = {} }, state = { backend = bedrock.gistBackend, gistId = "abc", bucket = "typo" } })
	end)

	t.it("should apply the built-in constraint to environment state overrides", function()
		local valid = bedrock.defineConfig({ environments = { production = { state = { backend = bedrock.gistBackend, gistId = "abc" } } } })
		t.expectTypeOf(valid.environments.production.state.backend):toEqualType<<"gist">>()
		-- @expect-error
		local invalid = bedrock.defineConfig({ environments = { production = { state = { backend = bedrock.gistBackend } } } })
	end)

	t.it("should leave plugin state keys open for module specifiers", function()
		local config = bedrock.defineConfig({ plugins = { "@example/state-s3" }, state = { backend = "s3", bucket = "my-bucket" }, environments = { production = { state = { backend = "custom", endpoint = "https://example.com" } } } })
		t.expectTypeOf(config.state.bucket):toEqualType<<string>>()
		t.expectTypeOf(config.environments.production.state.endpoint):toEqualType<<string>>()
		-- @expect-error
		local invalid = bedrock.defineConfig({ plugins = { "@example/state-s3" }, environments = { production = {} }, state = { backend = "s3", locking = "yes" } })
	end)

	t.it("should retain the open loaded-config state contract on checked types", function()
		local value = { environments = { production = {} }, state = { backend = "custom", bucket = "my-bucket" } }
		type Checked = bedrock.Config<typeof(value)>
		t.expectType<<Checked>>():toExtend<<typeof(value)>>()
		t.expectTypeOf(value.state.bucket):toEqualType<<string>>()
	end)

	t.it("should keep an explicitly empty plugin list on the built-in backend", function()
		local valid = bedrock.defineConfig({ plugins = {}, environments = { production = {} }, state = { backend = bedrock.gistBackend, gistId = "abc" } })
		t.expectTypeOf(valid.state.gistId):toEqualType<<string>>()
		-- @expect-error
		local invalid = bedrock.defineConfig({ plugins = {}, environments = { production = {} }, state = { backend = "s3", bucket = "my-bucket" } })
	end)
end)
