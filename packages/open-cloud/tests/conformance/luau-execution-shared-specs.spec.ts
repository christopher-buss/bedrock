import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "#src/domains/cloud-v2/luau-execution-tasks/specs";
import { describe, expect, it } from "vitest";

describe("luau-execution specs are frozen module-scope singletons", () => {
	it.for([
		["SUBMIT_HEAD_SPEC", SUBMIT_HEAD_SPEC],
		["SUBMIT_VERSION_SPEC", SUBMIT_VERSION_SPEC],
		["GET_SPEC", GET_SPEC],
	] as const)(
		"should be frozen so the dispatch wiring cannot be mutated at runtime",
		([, spec]) => {
			expect.assertions(1);
			expect(Object.isFrozen(spec)).toBeTrue();
		},
	);
});
