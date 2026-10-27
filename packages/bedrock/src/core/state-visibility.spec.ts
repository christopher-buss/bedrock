import { assert, describe, it } from "vitest";

import { parseStateContents, serializeStateFile } from "./state-file.ts";
import type { BedrockState } from "./state.ts";

describe("visibility State journal", () => {
	it("should round-trip unresolved and prepared work separately from Current state", ({
		expect,
	}) => {
		expect.hasAssertions();

		const state: BedrockState = {
			environment: "production",
			resources: [],
			universeVisibility: {
				preparation: "abc",
				status: "deferred",
				target: "public",
				universeId: "123",
			},
			version: 1,
		};
		const parsed = parseStateContents(serializeStateFile(state), "state.json");
		assert(parsed.success);

		expect(parsed.data).toStrictEqual(state);
		expect(JSON.parse(serializeStateFile(state))).toHaveProperty(
			"$bedrock.universeVisibility",
			state.universeVisibility,
		);
	});

	it("should reject malformed journal targets", ({ expect }) => {
		expect.hasAssertions();

		const raw = JSON.stringify({
			$bedrock: {
				universeVisibility: { status: "intent", target: "friends", universeId: "123" },
				version: 1,
			},
			environment: "production",
			resources: [],
		});

		expect(parseStateContents(raw, "state.json").success).toBeFalse();
	});
});
