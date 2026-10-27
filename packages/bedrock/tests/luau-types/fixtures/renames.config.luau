--!strict
local bedrock = require("@bedrock/config")
local function previous(entry: bedrock.GamePassEntry): string?
    return entry.movedFrom
end
assert(previous({ name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, movedFrom = "old" }) == "old")
local function productPrevious(entry: bedrock.DeveloperProductEntry): string? return entry.movedFrom end
local function placePrevious(entry: bedrock.PlaceEntry): string? return entry.movedFrom end
assert(productPrevious({ name = "Gems", description = "Currency", movedFrom = "old" }) == "old")
assert(placePrevious({ movedFrom = "old" }) == "old")
return bedrock.defineConfig({
    environments = { production = {
        places = { lobby = { placeId = "4711" } },
    } },
    passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, movedFrom = "old-vip" } },
    products = { gems = { name = "Gems", description = "Currency", movedFrom = "old-gems" } },
    places = { lobby = { movedFrom = "old-lobby" } },
    universe = { universeId = "123" },
})
