import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type {
	Asset,
	AssetsClient,
	AssetsClientOptions,
	DownloadAssetParameters,
	GetAssetParameters,
	ModerationState,
} from "./index.ts";

describe("DownloadAssetParameters", () => {
	it("should require assetId", () => {
		expectTypeOf<DownloadAssetParameters>().toExtend<{ assetId: string }>();
	});
});

describe("AssetsClientOptions", () => {
	it("should accept a fetch taking a url and init", () => {
		expectTypeOf<NonNullable<AssetsClientOptions["fetch"]>>().toEqualTypeOf<
			(url: string, init: RequestInit) => Promise<Response>
		>();
	});
});

describe("GetAssetParameters", () => {
	it("should require assetId", () => {
		expectTypeOf<GetAssetParameters>().toEqualTypeOf<{ readonly assetId: string }>();
	});
});

describe("Asset", () => {
	it("should carry the asset id and a moderation state", () => {
		expectTypeOf<Asset>().toEqualTypeOf<{
			readonly assetId: string;
			readonly moderationState: ModerationState;
		}>();
	});
});

describe("AssetsClient", () => {
	it("should resolve get() to Result<Asset, OpenCloudError>", () => {
		expectTypeOf<AssetsClient["get"]>().returns.resolves.toEqualTypeOf<
			Result<Asset, OpenCloudError>
		>();
	});

	it("should resolve download() to Result<Uint8Array, OpenCloudError>", () => {
		expectTypeOf<AssetsClient["download"]>().returns.resolves.toEqualTypeOf<
			Result<Uint8Array, OpenCloudError>
		>();
	});
});
