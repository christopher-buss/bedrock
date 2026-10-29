import path from "node:path";
import { describe, it } from "vitest";

import { createCompletionProbe } from "./completions.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

// Built once: loading the standard library dominates each probe.
const probe = createCompletionProbe({ projectDirectory: PACKAGE_ROOT });

describe(createCompletionProbe, () => {
	it("should list the members the editor offers at the marker", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(`
			interface Shape { alpha: number; beta: string }
			declare function take(value: Shape): void;
			take({ /*|*/ });
		`);

		expect(names).toIncludeAllMembers(["alpha", "beta"]);
	});

	it("should leave out globals when the position has a contextual type", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(`
			interface Shape { alpha: number }
			declare function take(value: Shape): void;
			take({ /*|*/ });
		`);

		expect(names).not.toContain("Array");
	});

	it("should return no names where the editor offers no completions", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt("// a comment /*|*/");

		expect(names).toBeEmpty();
	});

	it("should resolve imports relative to the project directory", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(`
			import { createCompletionProbe } from "./src/completions.ts";
			createCompletionProbe({ /*|*/ });
		`);

		expect(names).toContain("projectDirectory");
	});

	it("should resolve a bare package import through node_modules", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(`
			import ts from "typescript";
			ts.ScriptTarget./*|*/
		`);

		expect(names).toContain("Latest");
	});

	it("should still complete when the source references a missing file", ({ expect }) => {
		expect.assertions(1);

		const names = probe.completionsAt(`
			/// <reference path="./missing.ts" />
			interface Shape { alpha: number }
			declare function take(value: Shape): void;
			take({ /*|*/ });
		`);

		expect(names).toContain("alpha");
	});

	it("should throw when the source has no marker", ({ expect }) => {
		expect.assertions(1);

		expect(() => probe.completionsAt("const value = 1;")).toThrow("/*|*/");
	});
});

describe("createCompletionProbe without a tsconfig", () => {
	it("should throw when the project directory has no tsconfig.json", ({ expect }) => {
		expect.assertions(1);

		const projectDirectory = path.join(PACKAGE_ROOT, "src");

		expect(() => createCompletionProbe({ projectDirectory })).toThrow("tsconfig.json");
	});
});
