import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type { AssetsClient, AssetsClientOptions, DownloadAssetParameters } from "./index.ts";

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

describe("AssetsClient", () => {
	it("should resolve download() to Result<Uint8Array, OpenCloudError>", () => {
		expectTypeOf<AssetsClient["download"]>().returns.resolves.toEqualTypeOf<
			Result<Uint8Array, OpenCloudError>
		>();
	});
});
