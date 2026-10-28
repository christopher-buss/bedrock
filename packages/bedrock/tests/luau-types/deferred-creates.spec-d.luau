--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("allowDeferredCreates", function()
    t.it("should accept the setting on an Environment overlay", function()
        local config = bedrock.defineConfig({ environments = { dev = { allowDeferredCreates = true } } })
        t.expectTypeOf(config.environments.dev.allowDeferredCreates):toEqualType<<boolean>>()
    end)

    t.it("should reject a wrong type and the root placement", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { dev = { allowDeferredCreates = "yes" } } })
        -- @expect-error
        bedrock.defineConfig({ allowDeferredCreates = true, environments = { dev = {} } })
    end)
end)
