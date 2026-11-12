// Shop config for the import editor fixture.
export default {
	environments: {
		production: {
			passes: {
				vip: { price: 50 },
			},
		},
	},
	passes: {
		vip: {
			name: "VIP",
			// Shown in the store.
			description: "Perks",
			icon: { "en-us": "vip.png" },
		},
	},
	products: {
		coins: { name: "Coins", description: "Currency" },
	},
	universe: { universeId: "123" },
};
