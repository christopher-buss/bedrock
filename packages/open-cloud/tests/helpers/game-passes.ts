import type {
	GamePassConfigV2,
	ListGamePassConfigsByUniverseResponseWire,
} from "#src/domains/game-passes/game-passes/wire";

/**
 * Builds a minimally-valid {@link GamePassConfigV2} wire body. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant — useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validGamePassBody(overrides: Partial<GamePassConfigV2> = {}): GamePassConfigV2 {
	return {
		name: "Epic Pass",
		createdTimestamp: "2024-01-15T10:30:00.000Z",
		description: "Unlocks epic stuff",
		gamePassId: 12_345,
		iconAssetId: 67_890,
		isForSale: true,
		priceInformation: { defaultPriceInRobux: 100, enabledFeatures: [] },
		updatedTimestamp: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}

/**
 * Builds a minimally-valid {@link ListGamePassConfigsByUniverseResponseWire}
 * body. By default the page contains one game pass and the cursor is the
 * literal JSON `null` the API sends on the last page; `overrides` lets
 * parser and integration tests tweak the items array or the cursor
 * without rebuilding the whole shape.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied. `nextPageToken`
 *   carries the wire's literal `null` rather than `undefined` so the
 *   contract validator on the fake HTTP client sees the required
 *   property as present.
 */
export function validListGamePassesBody(
	overrides: Partial<ListGamePassConfigsByUniverseResponseWire> = {},
): ListGamePassConfigsByUniverseResponseWire {
	const body = {
		gamePasses: [validGamePassBody()],
		// eslint-disable-next-line unicorn/no-null -- mirrors the literal JSON null the API sends on the last page; the parser normalizes it away.
		nextPageToken: null,
		...overrides,
	};
	return body as unknown as ListGamePassConfigsByUniverseResponseWire;
}
