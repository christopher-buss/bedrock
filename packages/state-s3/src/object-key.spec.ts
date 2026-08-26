import { describe, expect, it } from "vitest";

import { objectKeyFor, objectLabelFor } from "./object-key.ts";

describe(objectKeyFor, () => {
	it("should name one object per environment when no prefix is configured", () => {
		expect.assertions(2);

		expect(objectKeyFor(undefined, "production")).toBe("production.json");
		expect(objectKeyFor(undefined, "staging")).toBe("staging.json");
	});

	it("should place the object under the configured prefix", () => {
		expect.assertions(1);

		expect(objectKeyFor("bedrock/state", "production")).toBe("bedrock/state/production.json");
	});

	it("should read a prefix the same whichever slashes surround it", () => {
		expect.assertions(1);

		const keys = new Set(
			["bedrock/state", "bedrock/state/", "/bedrock/state", "/bedrock/state/"].map(
				(prefix) => {
					return objectKeyFor(prefix, "production");
				},
			),
		);

		expect([...keys]).toStrictEqual(["bedrock/state/production.json"]);
	});

	it("should ignore a prefix that is only separators", () => {
		expect.assertions(2);

		expect(objectKeyFor("", "production")).toBe("production.json");
		expect(objectKeyFor("/", "production")).toBe("production.json");
	});
});

describe(objectLabelFor, () => {
	it("should name the object the way an operator would address it", () => {
		expect.assertions(1);

		expect(objectLabelFor("my-bucket", "bedrock/production.json")).toBe(
			"s3://my-bucket/bedrock/production.json",
		);
	});
});
