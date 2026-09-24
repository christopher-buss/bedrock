// cspell:ignore bunfs
import { describe, expect, it } from "vitest";

import { standaloneRuntimeEnvironment } from "./standalone-runtime.ts";

describe(standaloneRuntimeEnvironment, () => {
	it.for([
		{ platform: "macOS and Linux", url: "file:///$bunfs/root/bedrock" },
		{ platform: "Windows", url: "file:///B:/~BUN/root/bedrock.exe" },
	])(
		"should make a standalone binary behave as bun when loaded from its $platform virtual filesystem",
		({ url }) => {
			expect.assertions(1);

			expect(standaloneRuntimeEnvironment(url)).toStrictEqual({ BUN_BE_BUN: "1" });
		},
	);

	it("should add nothing when the cli runs from a file on disk", () => {
		expect.assertions(1);

		expect(
			standaloneRuntimeEnvironment(
				"file:///home/dev/node_modules/@bedrock-rbx/core/dist/cli/run.mjs",
			),
		).toStrictEqual({});
	});

	it("should add nothing for a disk path that merely contains a virtual filesystem segment", () => {
		expect.assertions(1);

		expect(standaloneRuntimeEnvironment("file:///home/dev/$bunfs/root/run.mjs")).toStrictEqual(
			{},
		);
	});
});
