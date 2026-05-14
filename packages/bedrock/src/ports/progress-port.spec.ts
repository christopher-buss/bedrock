import { describe, expect, it } from "vitest";

import type { DeployFailureEvent, DeploySuccessEvent } from "./progress-port.ts";

describe("progressEvent JSON serialization", () => {
	it("should round-trip a deploySuccess event with structural equality", () => {
		expect.assertions(1);

		const event: DeploySuccessEvent = {
			environment: "production",
			kind: "deploySuccess",
			resourceCount: 3,
		};

		const parsed: JSONValue = JSON.parse(JSON.stringify(event));

		expect(parsed).toStrictEqual(event);
	});

	it("should round-trip a deployFailure event whose DeployError carries no native Error", () => {
		expect.assertions(1);

		const event: DeployFailureEvent = {
			environment: "ghost",
			error: {
				declared: ["production", "staging"],
				environment: "ghost",
				kind: "unknownEnvironment",
			},
			kind: "deployFailure",
		};

		const parsed: JSONValue = JSON.parse(JSON.stringify(event));

		expect(parsed).toStrictEqual(event);
	});
});
