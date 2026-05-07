import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "#src/domains/cloud-v2/luau-execution-tasks/specs";
import { describe, expect, it } from "vitest";

describe("luau-execution specs are shared module-scope singletons", () => {
	it.for([
		["SUBMIT_HEAD_SPEC", SUBMIT_HEAD_SPEC],
		["SUBMIT_VERSION_SPEC", SUBMIT_VERSION_SPEC],
		["GET_SPEC", GET_SPEC],
	] as const)(
		"should be frozen so LuauExecutionClient and placesClient.luauExecution share one instance",
		([, spec]) => {
			expect.assertions(1);
			expect(Object.isFrozen(spec)).toBeTrue();
		},
	);
});
