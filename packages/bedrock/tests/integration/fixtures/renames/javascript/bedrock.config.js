export default {
	environments: {
		production: {
			passes: {
				vip: {
					movedFrom: "env-vip",
				},
			},
			places: {
				lobby: {
					movedFrom: "env-lobby",
					placeId: "4711",
				},
			},
			products: {
				gems: {
					movedFrom: "env-gems",
				},
			},
			universe: {
				movedFrom: "env-world",
			},
		},
		staging: {
			places: {
				lobby: {
					placeId: "4711",
				},
			},
		},
	},
	passes: {
		vip: {
			name: "VIP",
			description: "Perks",
			icon: {
				"en-us": "vip.png",
			},
			movedFrom: "old-vip",
		},
	},
	places: {
		lobby: {
			movedFrom: "old-lobby",
		},
	},
	products: {
		gems: {
			name: "Gems",
			description: "Currency",
			movedFrom: "old-gems",
		},
	},
	universe: {
		movedFrom: "old-world",
		universeId: "123",
	},
};
