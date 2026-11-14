--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("paymentSource", function()
    t.it("should accept the user source on an Environment overlay", function()
        local source: "user" = "user"
        local config = bedrock.defineConfig({ environments = { production = { paymentSource = source } } })
        t.expectTypeOf(config.environments.production.paymentSource):toEqualType<<"user">>()
    end)

    t.it("should reject other sources, a wrong type, and the root placement", function()
        local group: "group" = "group"
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { paymentSource = group } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { paymentSource = true } } })
        local source: "user" = "user"
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, paymentSource = source })
    end)
end)
