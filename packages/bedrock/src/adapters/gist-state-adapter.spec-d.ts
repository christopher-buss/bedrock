import { describe, expectTypeOf, it } from "vitest";

import type { GistStateAdapterDeps } from "./gist-state-adapter.ts";

describe("GistStateAdapterDeps", () => {
	it("should expose sleep as an optional injection seam", () => {
		expectTypeOf<GistStateAdapterDeps>()
			.toHaveProperty("sleep")
			.toEqualTypeOf<((ms: number) => Promise<void>) | undefined>();
	});

	it("should be constructible without sleep when the production default is desired", () => {
		expectTypeOf<{
			readonly gistId: string;
			readonly token: string;
		}>().toExtend<GistStateAdapterDeps>();
	});
});
