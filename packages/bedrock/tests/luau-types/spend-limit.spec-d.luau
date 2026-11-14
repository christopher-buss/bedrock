--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("spendLimit", function()
    t.it("should accept the limit on an Environment overlay", function()
        local config = bedrock.defineConfig({ environments = { production = { spendLimit = 500 } } })
        t.expectTypeOf(config.environments.production.spendLimit):toEqualType<<number>>()
    end)

    t.it("should reject a wrong type and the root placement", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { spendLimit = "500" } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, spendLimit = 500 })
    end)
end)
