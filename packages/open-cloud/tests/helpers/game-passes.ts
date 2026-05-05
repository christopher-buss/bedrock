import type { GamePassConfigV2 } from "#src/domains/game-passes/game-passes/wire";

/**
 * Test-only wire shape for the list response. Mirrors the OpenAPI
 * schema, which marks `nextPageToken` as required and nullable, so
 * fixtures can carry the literal JSON `null` the API sends on the last
 * page without leaking `null` into the production wire type (which
 * exposes a post-normalization view of `string | undefined`).
 */
interface ListGamePassesWireBody {
	readonly gamePasses: ReadonlyArray<GamePassConfigV2>;

	readonly nextPageToken: null | string;
}

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
 * Builds a minimally-valid wire body for the "list game passes" endpoint.
 * By default the page contains one game pass and `nextPageToken` is the
 * literal JSON `null` the API sends on the last page; `overrides` let
 * parser and integration tests tweak the items array or the cursor
 * without rebuilding the whole shape.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied. `nextPageToken`
 *   defaults to the wire's literal `null`, which the response parser
 *   normalizes to `undefined` at the boundary.
 */
export function validListGamePassesBody(
	overrides: Partial<ListGamePassesWireBody> = {},
): ListGamePassesWireBody {
	return {
		gamePasses: [validGamePassBody()],
		// eslint-disable-next-line unicorn/no-null -- API sends null on the last page; parser normalizes to undefined.
		nextPageToken: null,
		...overrides,
	};
}
