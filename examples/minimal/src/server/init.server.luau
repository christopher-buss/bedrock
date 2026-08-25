--!strict

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Rojo maps `.bedrock/generated` here; see `default.project.json`.
local resources = require(ReplicatedStorage.Bedrock.resources)

-- The key is the one declared under `products` in `bedrock.config.ts`. The id
-- behind it was assigned by Roblox on the deploy that created the product.
local SMALL_COIN_PACK: number = resources.production["coins-small"].productId

Players.PlayerAdded:Connect(function(player: Player)
	MarketplaceService:PromptProductPurchase(player, SMALL_COIN_PACK)
end)
