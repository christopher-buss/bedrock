import { MarketplaceService, Players } from "@rbxts/services";

import { GAME_PASSES, GameId, PRODUCTS } from "shared/assets/resources";

// One built place serves both environments: the ids are resolved at runtime
// from the universe the server is running in.
const universe = game.GameId as GameId;

const coinPack = PRODUCTS["coins-small"][universe];
const vipPass = GAME_PASSES["vip-pass"][universe];

Players.PlayerAdded.Connect((player) => {
	if (coinPack !== undefined) {
		MarketplaceService.PromptProductPurchase(player, coinPack.assetId);
	}

	if (vipPass !== undefined) {
		print(`${player.Name} joined; VIP is ${vipPass.price} Robux`);
	}
});
