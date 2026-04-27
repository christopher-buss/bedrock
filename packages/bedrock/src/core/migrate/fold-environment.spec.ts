import { assert, describe, expect, it } from "vitest";

import { foldEnvironment } from "./fold-environment.ts";
import type { MantleResource } from "./types.ts";

function experience(): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs: { groupId: undefined },
		kind: "experience",
		outputs: { assetId: 6031475575, startPlaceId: 17613681043 },
	};
}

describe(foldEnvironment, () => {
	it("should expose the folded universe entry when an experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		assert(result.universe !== undefined);

		expect(result.universe.entry).toStrictEqual({ universeId: "6031475575" });
	});

	it("should expose the folded universe outputs when an experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		assert(result.universe !== undefined);

		expect(result.universe.outputs).toStrictEqual({ rootPlaceId: "17613681043" });
	});

	it("should leave universe undefined when no experience resource is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([]);

		expect(result.universe).toBeUndefined();
	});

	it("should aggregate an empty warnings list in the skeleton", () => {
		expect.assertions(1);

		const result = foldEnvironment([experience()]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should produce empty warnings even when no experience is present", () => {
		expect.assertions(1);

		const result = foldEnvironment([]);

		expect(result.warnings).toStrictEqual([]);
	});
});
