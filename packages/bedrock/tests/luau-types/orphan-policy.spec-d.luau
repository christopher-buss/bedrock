--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Orphan policy", function()
    t.it("should accept both policies and omission", function()
        local retire: bedrock.OrphanPolicy = "retire"
        local error: bedrock.OrphanPolicy = "error"
        local automatic = bedrock.defineConfig({ environments = { production = {} }, orphans = retire })
        local explicit = bedrock.defineConfig({ environments = { production = {} }, orphans = error })
        local default = bedrock.defineConfig({ environments = { production = {} } })
        t.expectTypeOf(automatic.orphans):toEqualType<<bedrock.OrphanPolicy>>()
        t.expectTypeOf(explicit.orphans):toEqualType<<bedrock.OrphanPolicy>>()
        t.expectTypeOf(default.environments.production):toEqualType<<{}>>()
    end)

    t.it("should reject unsupported values and environment overrides", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, orphans = "delete" })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, orphans = true })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, orphans = 1 })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, orphans = {} })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { orphans = "retire" } } })
        local bad = { environments = { production = {} }, orphans = "destroy" }
        -- @expect-error
        local checked: bedrock.Config<typeof(bad)> = bad
    end)
end)

