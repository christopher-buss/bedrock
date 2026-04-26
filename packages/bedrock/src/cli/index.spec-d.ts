import type { Sade } from "sade";
import { describe, expectTypeOf, it } from "vitest";

import type { deploy } from "../shell/deploy.ts";
import type { loadConfig } from "../shell/load-config.ts";
import type { previewDiff } from "../shell/preview-diff.ts";
import type { ProgDeps } from "./index.ts";
import { createProg } from "./index.ts";
import type { ClackPort } from "./render.ts";

describe("ProgDeps", () => {
	it("should expose exactly the five injection slots", () => {
		expectTypeOf<keyof ProgDeps>().toEqualTypeOf<
			"clack" | "deploy" | "exit" | "loadConfig" | "previewDiff"
		>();
	});

	it("should mark every slot as optional so an empty deps object satisfies ProgDeps", () => {
		expectTypeOf<Record<string, never>>().toExtend<ProgDeps>();
	});

	it("should accept the real deploy signature in the deploy slot", () => {
		expectTypeOf<NonNullable<ProgDeps["deploy"]>>().toEqualTypeOf<typeof deploy>();
	});

	it("should accept the real previewDiff signature in the previewDiff slot", () => {
		expectTypeOf<NonNullable<ProgDeps["previewDiff"]>>().toEqualTypeOf<typeof previewDiff>();
	});

	it("should accept the real loadConfig signature in the loadConfig slot", () => {
		expectTypeOf<NonNullable<ProgDeps["loadConfig"]>>().toEqualTypeOf<typeof loadConfig>();
	});

	it("should accept the ClackPort interface in the clack slot", () => {
		expectTypeOf<NonNullable<ProgDeps["clack"]>>().toEqualTypeOf<ClackPort>();
	});

	it("should accept a void-returning exit handle so test stubs can intercept termination", () => {
		expectTypeOf<NonNullable<ProgDeps["exit"]>>().toEqualTypeOf<(code: number) => void>();
	});
});

describe(createProg, () => {
	it("should accept an optional ProgDeps argument and return a sade Sade instance", () => {
		expectTypeOf(createProg).parameter(0).toEqualTypeOf<ProgDeps | undefined>();
		expectTypeOf<ReturnType<typeof createProg>>().toEqualTypeOf<Sade>();
	});
});
