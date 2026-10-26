--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Retirement", function()
    t.it("should accept root and overlay retirement markers", function()
        local pass: bedrock.RetiredEntry = { retired = true }
        local config = bedrock.defineConfig({
            passes = { vip = pass },
            environments = { production = { passes = { vip = { retired = true } } } },
        })
        t.expectTypeOf(config.passes.vip.retired):toEqualType<<true | "untrack">>()
    end)
end)
