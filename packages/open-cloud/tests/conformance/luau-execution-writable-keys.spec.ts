import type { SubmitAtHeadParameters } from "#src/domains/cloud-v2/luau-execution-tasks/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

const SUBMIT_PARAMETER_KEYS = ["script", "timeoutSeconds"] as const;

type SubmitParameterKey = (typeof SUBMIT_PARAMETER_KEYS)[number];

const WIRE_NAMES: Readonly<Record<SubmitParameterKey, string>> = Object.freeze({
	script: "script",
	timeoutSeconds: "timeout",
});

expectTypeOf<SubmitParameterKey>().toEqualTypeOf<
	Exclude<keyof SubmitAtHeadParameters, "placeId" | "universeId">
>();

describe("luau-execution-tasks submit writable-keys pin", () => {
	it.for(SUBMIT_PARAMETER_KEYS)(
		"should expose %s as a non-readOnly property on the LuauExecutionSessionTask schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("LuauExecutionSessionTask")).toContain(
				WIRE_NAMES[key],
			);
		},
	);
});
