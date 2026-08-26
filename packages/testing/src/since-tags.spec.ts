import { describe, expect, it } from "vitest";

import {
	isResolvableSource,
	isValidSinceTag,
	publishedVersion,
	resolveUnreleasedSinceTags,
	UNRELEASED_SINCE,
} from "./since-tags.ts";

describe(isValidSinceTag, () => {
	it("should accept the unreleased placeholder", () => {
		expect.assertions(1);

		expect(isValidSinceTag(UNRELEASED_SINCE, "0.1.5")).toBeTrue();
	});

	it.for<[label: string, tag: string, current: string]>([
		["the current version itself", "0.1.5", "0.1.5"],
		["an earlier patch", "0.1.4", "0.1.5"],
		["an earlier minor", "0.0.9", "0.1.5"],
		["an earlier major", "0.9.9", "1.0.0"],
		["a single-digit minor below a double-digit one", "0.9.9", "0.10.0"],
		["a prerelease of the current version", "0.1.5-beta.1", "0.1.5"],
		["the current version with build metadata", "0.1.5+20260826", "0.1.5"],
	])("should accept a tag at %s", ([, tag, current]) => {
		expect.assertions(1);

		expect(isValidSinceTag(tag, current)).toBeTrue();
	});

	it.for<[label: string, tag: string, current: string]>([
		["a later patch", "0.1.6", "0.1.5"],
		["a later minor", "0.2.0", "0.1.5"],
		["a later major", "1.0.0", "0.1.5"],
	])("should reject a tag at %s than the package version", ([, tag, current]) => {
		expect.assertions(1);

		expect(isValidSinceTag(tag, current)).toBeFalse();
	});

	it("should reject a missing tag", () => {
		expect.assertions(1);

		expect(isValidSinceTag(undefined, "0.1.5")).toBeFalse();
	});

	it("should reject an otherwise valid tag when the package version is not a version", () => {
		expect.assertions(1);

		expect(isValidSinceTag("0.1.0", "workspace:*")).toBeFalse();
	});

	it.for<[label: string, tag: string]>([
		["free prose", "next release"],
		["a partial version", "0.1"],
		["a version with trailing junk", "0.1.5abc"],
		["a near-miss of the placeholder", `${UNRELEASED_SINCE}-soon`],
	])("should reject %s", ([, tag]) => {
		expect.assertions(1);

		expect(isValidSinceTag(tag, "0.1.5")).toBeFalse();
	});
});

describe(resolveUnreleasedSinceTags, () => {
	it("should rewrite every placeholder to the release version", () => {
		expect.assertions(1);

		const source = [
			"/** @since unreleased */",
			"export const a = 1;",
			"/** @since unreleased */",
			"export const b = 2;",
		].join("\n");

		expect(resolveUnreleasedSinceTags(source, "0.1.6")).toBe(
			[
				"/** @since 0.1.6 */",
				"export const a = 1;",
				"/** @since 0.1.6 */",
				"export const b = 2;",
			].join("\n"),
		);
	});

	it("should preserve the whitespace between the tag and its value", () => {
		expect.assertions(1);

		expect(resolveUnreleasedSinceTags(" * @since   unreleased", "0.1.6")).toBe(
			" * @since   0.1.6",
		);
	});

	it.for<[label: string, source: string]>([
		["an already-versioned tag", " * @since 0.1.0"],
		["a longer word starting with the placeholder", ` * @since ${UNRELEASED_SINCE}ish`],
		["a hyphenated near-miss of the placeholder", ` * @since ${UNRELEASED_SINCE}-soon`],
		["the placeholder outside a since tag", " * unreleased"],
	])("should leave %s untouched", ([, source]) => {
		expect.assertions(1);

		expect(resolveUnreleasedSinceTags(source, "0.1.6")).toBe(source);
	});
});

describe(publishedVersion, () => {
	it("should return the version of a published package", () => {
		expect.assertions(1);

		expect(publishedVersion('{ "name": "pkg", "version": "0.1.5" }')).toBe("0.1.5");
	});

	it("should return the version when the manifest opts out of privacy explicitly", () => {
		expect.assertions(1);

		expect(publishedVersion('{ "version": "0.1.5", "private": false }')).toBe("0.1.5");
	});

	it("should return undefined for a private package", () => {
		expect.assertions(1);

		expect(publishedVersion('{ "version": "0.0.0", "private": true }')).toBeUndefined();
	});

	it.for<[label: string, manifest: string]>([
		["the manifest declares no version", '{ "name": "pkg" }'],
		["the version is not a string", '{ "version": 1 }'],
		["the manifest is a JSON null", "null"],
		["the manifest is an array", "[]"],
	])("should return undefined when %s", ([, manifest]) => {
		expect.assertions(1);

		expect(publishedVersion(manifest)).toBeUndefined();
	});
});

describe(isResolvableSource, () => {
	it.for<[label: string, relativePath: string]>([
		["a module at the source root", "src/types.ts"],
		["a nested module", "src/domains/game-passes/types.ts"],
		["a package build script", "scripts/fetch-locales.ts"],
	])("should resolve %s", ([, relativePath]) => {
		expect.assertions(1);

		expect(isResolvableSource(relativePath)).toBeTrue();
	});

	it.for<[label: string, relativePath: string]>([
		["a colocated unit test", "src/types.spec.ts"],
		["a type-level test", "src/types.spec-d.ts"],
		["a generated example test", "src/types.example.spec.ts"],
	])("should skip %s", ([, relativePath]) => {
		expect.assertions(1);

		expect(isResolvableSource(relativePath)).toBeFalse();
	});
});
