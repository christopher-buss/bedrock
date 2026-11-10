import { describe, expectTypeOf, it } from "vitest";

import type {
	LiveSnapshot,
	MissingLiveResource,
	OpenCloudError,
	OutOfBandEdit,
	ResourceCurrentState,
	ResourceDriver,
	ResourceLiveState,
	Result,
	RobloxAssetId,
} from "../index.ts";
import { compareLiveState } from "../index.ts";

describe("public Live state contracts", () => {
	it("should expose Kind-specific optional Driver reads and lists through the public barrel", () => {
		expectTypeOf<NonNullable<ResourceDriver<"gamePass">["read"]>>().toEqualTypeOf<
			(
				id: RobloxAssetId,
			) => Promise<Result<ResourceLiveState<"gamePass"> | undefined, OpenCloudError>>
		>();
		expectTypeOf<NonNullable<ResourceDriver<"badge">["list"]>>().toEqualTypeOf<
			() => Promise<
				Result<ReadonlyMap<RobloxAssetId, ResourceLiveState<"badge">>, OpenCloudError>
			>
		>();
		expectTypeOf<ResourceDriver<"gamePass">["read"]>().toBeNullable();
		expectTypeOf<ResourceDriver<"gamePass">["list"]>().toBeNullable();
		expectTypeOf<ResourceLiveState<"gamePass">["price"]>().toEqualTypeOf<number | undefined>();
		expectTypeOf<ResourceLiveState<"badge">>().not.toHaveProperty("price");
		expectTypeOf<ResourceLiveState>().not.toHaveProperty("key");
		expectTypeOf<ResourceLiveState<"gamePass">["outputs"]["iconAssetIds"]>().toEqualTypeOf<
			Record<"en-us", RobloxAssetId> | undefined
		>();
		expectTypeOf<ResourceLiveState<"badge">["outputs"]["iconImageId"]>().toEqualTypeOf<
			RobloxAssetId | undefined
		>();
		expectTypeOf<LiveSnapshot["badge"]>().toEqualTypeOf<
			ReadonlyMap<RobloxAssetId, ResourceLiveState<"badge">> | undefined
		>();
	});

	it("should expose comparison reports and the refreshed resource baseline", () => {
		expectTypeOf(compareLiveState).returns.toEqualTypeOf<{
			readonly edits: ReadonlyArray<OutOfBandEdit>;
			readonly missing: ReadonlyArray<MissingLiveResource>;
			readonly resources: ReadonlyArray<ResourceCurrentState>;
		}>();
	});
});
