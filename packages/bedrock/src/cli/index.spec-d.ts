import type { Sade } from "sade";
import { describe, expectTypeOf, it } from "vitest";

import type { ProgressPort } from "../ports/progress-port.ts";
import type { buildStatePort } from "../shell/build-state-port.ts";
import type { deploy } from "../shell/deploy.ts";
import type { loadConfig } from "../shell/load-config.ts";
import type { migrateMantleState } from "../shell/migrate-mantle-state.ts";
import type { previewDiff } from "../shell/preview-diff.ts";
import type { ProgDeps } from "./index.ts";
import { createProg } from "./index.ts";
import type { MigratePromptPort } from "./migrate-prompt-port.ts";
import type { ClackPort } from "./render.ts";

describe("ProgDeps shape", () => {
	it("should expose exactly the configured injection slots", () => {
		expectTypeOf<keyof ProgDeps>().toEqualTypeOf<
			| "buildStatePort"
			| "clack"
			| "deploy"
			| "exit"
			| "loadConfig"
			| "migrateMantleState"
			| "migratePromptPort"
			| "mkdir"
			| "previewDiff"
			| "progress"
			| "writeFile"
		>();
	});

	it("should mark every slot as optional so an empty deps object satisfies ProgDeps", () => {
		expectTypeOf<Record<string, never>>().toExtend<ProgDeps>();
	});
});

describe("ProgDeps deploy/diff slots", () => {
	it("should accept the real deploy signature in the deploy slot", () => {
		expectTypeOf<NonNullable<ProgDeps["deploy"]>>().toEqualTypeOf<typeof deploy>();
	});

	it("should accept the real previewDiff signature in the previewDiff slot", () => {
		expectTypeOf<NonNullable<ProgDeps["previewDiff"]>>().toEqualTypeOf<typeof previewDiff>();
	});

	it("should accept the real loadConfig signature in the loadConfig slot", () => {
		expectTypeOf<NonNullable<ProgDeps["loadConfig"]>>().toEqualTypeOf<typeof loadConfig>();
	});
});

describe("ProgDeps migrate slots", () => {
	it("should accept the real buildStatePort signature in the buildStatePort slot", () => {
		expectTypeOf<NonNullable<ProgDeps["buildStatePort"]>>().toEqualTypeOf<
			typeof buildStatePort
		>();
	});

	it("should accept the real migrateMantleState signature in the migrateMantleState slot", () => {
		expectTypeOf<NonNullable<ProgDeps["migrateMantleState"]>>().toEqualTypeOf<
			typeof migrateMantleState
		>();
	});

	it("should accept the MigratePromptPort interface in the migratePromptPort slot", () => {
		expectTypeOf<
			NonNullable<ProgDeps["migratePromptPort"]>
		>().toEqualTypeOf<MigratePromptPort>();
	});

	it("should accept a (path, contents) writeFile signature in the writeFile slot", () => {
		expectTypeOf<NonNullable<ProgDeps["writeFile"]>>().toEqualTypeOf<
			(path: string, contents: string) => Promise<void>
		>();
	});

	it("should accept a (path) mkdir signature in the mkdir slot", () => {
		expectTypeOf<NonNullable<ProgDeps["mkdir"]>>().toEqualTypeOf<
			(path: string) => Promise<void>
		>();
	});
});

describe("ProgDeps render slots", () => {
	it("should accept the ClackPort interface in the clack slot", () => {
		expectTypeOf<NonNullable<ProgDeps["clack"]>>().toEqualTypeOf<ClackPort>();
	});

	it("should accept the ProgressPort interface in the progress slot", () => {
		expectTypeOf<NonNullable<ProgDeps["progress"]>>().toEqualTypeOf<ProgressPort>();
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
