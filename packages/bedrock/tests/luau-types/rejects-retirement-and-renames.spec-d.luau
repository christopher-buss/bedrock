--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")
local retire: true = true
local untrack: "untrack" = "untrack"

t.describe("Retirement and rename authoring guards", function()
    t.it("should preserve valid retirement markers at both factory boundaries", function()
        local environment = bedrock.defineEnvironment({
            passes = { vip = { retired = retire } },
            products = { gems = { retired = untrack } },
            places = { lobby = { retired = retire } },
        })
        local config = bedrock.defineConfig({
            environments = { production = environment },
            passes = { vip = { retired = untrack } },
            products = { gems = { retired = retire } },
            places = { lobby = { retired = untrack } },
        })
        t.expectTypeOf(config.products.gems.retired):toEqualType<<true>>()
        t.expectTypeOf(environment.products.gems.retired):toEqualType<<"untrack">>()
    end)

    t.it("should preserve movedFrom on root resource entries", function()
        local config = bedrock.defineConfig({
            environments = { production = { places = { lobby = { placeId = "456" } } } },
            passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, movedFrom = "older-vip" } },
            products = { gems = { name = "Gems", description = "Perks", movedFrom = "older-gems" } },
            places = { lobby = { movedFrom = "older-lobby" } },
        })
        t.expectTypeOf(config.passes.vip.movedFrom):toEqualType<<string>>()
        t.expectTypeOf(config.places.lobby.movedFrom):toEqualType<<string>>()
    end)

    t.it("should reject movedFrom on environment overlays", function()
        -- @expect-error
        bedrock.defineEnvironment({ passes = { vip = { movedFrom = "old-vip" } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { gems = { movedFrom = "old-gems" } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { lobby = { placeId = "456", movedFrom = "old-lobby" } } })
    end)

    t.it("should reject wrong-typed movedFrom in passes root entries and overlays", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, passes = { item = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, movedFrom = 42 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { passes = { item = { name = "VIP", movedFrom = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ passes = { item = { name = "VIP", movedFrom = {} } } })
    end)

    t.it("should reject unsupported retired value false in passes", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, passes = { item = { retired = false } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { passes = { item = { retired = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ passes = { item = { retired = false } } })
    end)

    t.it("should reject unsupported retired value 1 in passes", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, passes = { item = { retired = 1 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { passes = { item = { retired = 1 } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ passes = { item = { retired = 1 } } })
    end)

    t.it("should reject unsupported retired value delete in passes", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, passes = { item = { retired = "delete" } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { passes = { item = { retired = "delete" } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ passes = { item = { retired = "delete" } } })
    end)

    t.it("should reject retirement markers combined with live passes fields", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, passes = { item = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, retired = retire } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { passes = { item = { name = "VIP", retired = retire } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ passes = { item = { name = "VIP", retired = retire } } })
    end)

    t.it("should reject wrong-typed movedFrom in products root entries and overlays", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, products = { item = { name = "Gems", description = "Perks", movedFrom = 42 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { products = { item = { name = "Gems", movedFrom = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { item = { name = "Gems", movedFrom = {} } } })
    end)

    t.it("should reject unsupported retired value false in products", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, products = { item = { retired = false } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { products = { item = { retired = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { item = { retired = false } } })
    end)

    t.it("should reject unsupported retired value 1 in products", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, products = { item = { retired = 1 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { products = { item = { retired = 1 } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { item = { retired = 1 } } })
    end)

    t.it("should reject unsupported retired value delete in products", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, products = { item = { retired = "delete" } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { products = { item = { retired = "delete" } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { item = { retired = "delete" } } })
    end)

    t.it("should reject retirement markers combined with live products fields", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, products = { item = { name = "Gems", description = "Perks", retired = retire } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { products = { item = { name = "Gems", retired = retire } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ products = { item = { name = "Gems", retired = retire } } })
    end)

    t.it("should reject wrong-typed movedFrom in places root entries and overlays", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, places = { item = { displayName = "Lobby", movedFrom = 42 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { places = { item = { placeId = "123", displayName = "Lobby", movedFrom = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { item = { placeId = "123", displayName = "Lobby", movedFrom = {} } } })
    end)

    t.it("should reject unsupported retired value false in places", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, places = { item = { retired = false } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { places = { item = { retired = false } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { item = { retired = false } } })
    end)

    t.it("should reject unsupported retired value 1 in places", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, places = { item = { retired = 1 } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { places = { item = { retired = 1 } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { item = { retired = 1 } } })
    end)

    t.it("should reject unsupported retired value delete in places", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, places = { item = { retired = "delete" } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { places = { item = { retired = "delete" } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { item = { retired = "delete" } } })
    end)

    t.it("should reject retirement markers combined with live places fields", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, places = { item = { displayName = "Lobby", retired = retire } } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { places = { item = { placeId = "123", displayName = "Lobby", retired = retire } } } } })
        -- @expect-error
        bedrock.defineEnvironment({ places = { item = { placeId = "123", displayName = "Lobby", retired = retire } } })
    end)

    t.it("should reject universe movedFrom at both factory boundaries", function()
        -- @expect-error
        bedrock.defineConfig({ environments = { production = {} }, universe = { universeId = "123", movedFrom = "old-world" } })
        -- @expect-error
        bedrock.defineConfig({ environments = { production = { universe = { movedFrom = "old-world" } } } })
        -- @expect-error
        bedrock.defineEnvironment({ universe = { movedFrom = "old-world" } })
    end)
end)
