import { describe, expect, it } from "vitest";

import { lockKeyFor, objectKeyFor, objectLabelFor } from "./object-key.ts";

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

describe(lockKeyFor, () => {
	it("should keep the lock under its own segment so a lifecycle rule can expire it", () => {
		expect.assertions(2);

		expect(lockKeyFor(undefined, "production")).toBe("locks/production.json");
		expect(lockKeyFor("bedrock/state", "production")).toBe(
			"bedrock/state/locks/production.json",
		);
	});

	it("should never collide with the state object of the same environment", () => {
		expect.assertions(1);

		expect(lockKeyFor("bedrock", "production")).not.toBe(objectKeyFor("bedrock", "production"));
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
