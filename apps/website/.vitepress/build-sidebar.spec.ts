import { describe, expect, it } from "vitest";

import { buildSidebarFromNavigation, type NavigationItem } from "./build-sidebar.ts";

describe(buildSidebarFromNavigation, () => {
	it("should return an empty array for empty navigation", () => {
		expect.assertions(1);

		expect(buildSidebarFromNavigation([], "/bedrock/api/")).toStrictEqual([]);
	});

	it("should map a leaf item to a sidebar link with the base path and without the .md suffix", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{ path: "interfaces/UniverseEntry.md", title: "UniverseEntry" },
		];

		expect(buildSidebarFromNavigation(nav, "/bedrock/api/")).toStrictEqual([
			{ link: "/bedrock/api/interfaces/UniverseEntry", text: "UniverseEntry" },
		]);
	});

	it("should represent a branch with children as a collapsed group of its items", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{
				children: [
					{ path: "interfaces/PlaceEntry.md", title: "PlaceEntry" },
					{ path: "interfaces/UniverseEntry.md", title: "UniverseEntry" },
				],
				title: "Interfaces",
			},
		];

		expect(buildSidebarFromNavigation(nav, "/bedrock/api/")).toStrictEqual([
			{
				collapsed: true,
				items: [
					{ link: "/bedrock/api/interfaces/PlaceEntry", text: "PlaceEntry" },
					{ link: "/bedrock/api/interfaces/UniverseEntry", text: "UniverseEntry" },
				],
				text: "Interfaces",
			},
		]);
	});

	it("should emit both link and items when a branch carries its own path", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{
				children: [{ path: "interfaces/GamePass.md", title: "GamePass" }],
				path: "resources/game-passes/readme.md",
				title: "Game Passes",
			},
		];

		expect(buildSidebarFromNavigation(nav, "/ocale/api/")).toStrictEqual([
			{
				collapsed: true,
				items: [{ link: "/ocale/api/interfaces/GamePass", text: "GamePass" }],
				link: "/ocale/api/resources/game-passes/readme",
				text: "Game Passes",
			},
		]);
	});

	it("should recurse into grandchild branches", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{
				children: [
					{
						children: [
							{
								path: "resources/game-passes/classes/GamePassesClient.md",
								title: "GamePassesClient",
							},
						],
						title: "Classes",
					},
				],
				title: "Game Passes",
			},
		];

		expect(buildSidebarFromNavigation(nav, "/ocale/api/")).toStrictEqual([
			{
				collapsed: true,
				items: [
					{
						collapsed: true,
						items: [
							{
								link: "/ocale/api/resources/game-passes/classes/GamePassesClient",
								text: "GamePassesClient",
							},
						],
						text: "Classes",
					},
				],
				text: "Game Passes",
			},
		]);
	});

	it("should skip items that have neither a path nor children", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{ title: "Orphan" },
			{ path: "interfaces/Universe.md", title: "Universe" },
		];

		expect(buildSidebarFromNavigation(nav, "/bedrock/api/")).toStrictEqual([
			{ link: "/bedrock/api/interfaces/Universe", text: "Universe" },
		]);
	});

	it("should leave a leading slash in the base path alone when the item path has no leading slash", () => {
		expect.assertions(1);

		const nav: ReadonlyArray<NavigationItem> = [
			{ path: "functions/deploy.md", title: "deploy" },
		];

		expect(buildSidebarFromNavigation(nav, "/bedrock/api/")).toStrictEqual([
			{ link: "/bedrock/api/functions/deploy", text: "deploy" },
		]);
	});
});
