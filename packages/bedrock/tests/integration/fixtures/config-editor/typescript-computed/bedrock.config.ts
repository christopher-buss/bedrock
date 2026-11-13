// Passes come partly from a shared map, so the editor cannot add one.
const extraPasses = {};

export default {
	environments: {
		production: {
			passes: {
				vip: { price: 50 },
			},
		},
	},
	passes: {
		...extraPasses,
		vip: {
			name: "VIP",
			description: "Perks",
			icon: { "en-us": "vip.png" },
		},
	},
	products: {
		coins: { name: "Coins", description: "Currency" },
	},
	universe: { universeId: "123" },
};
