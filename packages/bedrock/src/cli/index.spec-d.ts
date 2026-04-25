import type { Sade } from "sade";
import { describe, expectTypeOf, it } from "vitest";

import type { diff } from "../core/diff.ts";
import type { deploy } from "../shell/deploy.ts";
import type { loadConfig } from "../shell/load-config.ts";
import type { ProgDeps } from "./index.ts";
import { createProg } from "./index.ts";
import type { ClackPort } from "./render.ts";

describe("ProgDeps", () => {
	it("should expose exactly the five injection slots", () => {
		expectTypeOf<keyof ProgDeps>().toEqualTypeOf<
			"clack" | "deploy" | "diff" | "exit" | "loadConfig"
		>();
	});

	it("should mark every slot as optional so an empty deps object satisfies ProgDeps", () => {
		expectTypeOf<Record<string, never>>().toExtend<ProgDeps>();
	});

	it("should accept the real deploy signature in the deploy slot", () => {
		expectTypeOf<NonNullable<ProgDeps["deploy"]>>().toEqualTypeOf<typeof deploy>();
	});

	it("should accept the real diff signature in the diff slot", () => {
		expectTypeOf<NonNullable<ProgDeps["diff"]>>().toEqualTypeOf<typeof diff>();
	});

	it("should accept the real loadConfig signature in the loadConfig slot", () => {
		expectTypeOf<NonNullable<ProgDeps["loadConfig"]>>().toEqualTypeOf<typeof loadConfig>();
	});

	it("should accept the ClackPort interface in the clack slot", () => {
		expectTypeOf<NonNullable<ProgDeps["clack"]>>().toEqualTypeOf<ClackPort>();
	});

	it("should accept a never-returning exit handle in the exit slot", () => {
		expectTypeOf<NonNullable<ProgDeps["exit"]>>().toEqualTypeOf<(code: number) => never>();
	});
});

describe(createProg, () => {
	it("should accept an optional ProgDeps argument and return a sade Sade instance", () => {
		expectTypeOf(createProg).parameter(0).toEqualTypeOf<ProgDeps | undefined>();
		expectTypeOf<ReturnType<typeof createProg>>().toEqualTypeOf<Sade>();
	});
});
