import { assert, describe, expect, it } from "vitest";

import { parseStateMoveOptions } from "./parse-state-move-options.ts";

const ENV_ONLY = { env: "production" } as const;

function neverReadEnvironment(): undefined {}

describe(parseStateMoveOptions, () => {
	it("should read the destination backend and its coordinates off the flags", () => {
		expect.assertions(2);

		const parsed = parseStateMoveOptions(
			{ ...ENV_ONLY, "to": "s3", "to-bucket": "my-state", "to-region": "eu-west-2" },
			neverReadEnvironment,
		);

		assert(parsed.success);

		expect(parsed.data.to).toBe("s3");
		expect(parsed.data.coordinates).toStrictEqual({
			bucket: "my-state",
			region: "eu-west-2",
		});
	});

	it("should carry the common options through", () => {
		expect.assertions(2);

		const parsed = parseStateMoveOptions(
			{ config: "bedrock.config.ts", env: ["production", "staging"] },
			neverReadEnvironment,
		);

		assert(parsed.success);

		expect(parsed.data.common.environments).toStrictEqual(["production", "staging"]);
		expect(parsed.data.common.configFile).toBe("bedrock.config.ts");
	});

	it("should leave the destination unnamed when no flag supplied one", () => {
		expect.assertions(2);

		const parsed = parseStateMoveOptions(ENV_ONLY, neverReadEnvironment);

		assert(parsed.success);

		expect(parsed.data.to).toBeUndefined();
		expect(parsed.data.coordinates).toStrictEqual({});
	});

	it("should default both switches to off", () => {
		expect.assertions(2);

		const parsed = parseStateMoveOptions(ENV_ONLY, neverReadEnvironment);

		assert(parsed.success);

		expect(parsed.data.dryRun).toBeFalse();
		expect(parsed.data.force).toBeFalse();
	});

	it("should turn both switches on when they are passed", () => {
		expect.assertions(2);

		const parsed = parseStateMoveOptions(
			{ ...ENV_ONLY, "dry-run": true, "force": true },
			neverReadEnvironment,
		);

		assert(parsed.success);

		expect(parsed.data.dryRun).toBeTrue();
		expect(parsed.data.force).toBeTrue();
	});

	it("should accept the camel-cased spelling of the dry-run switch", () => {
		expect.assertions(1);

		const parsed = parseStateMoveOptions({ ...ENV_ONLY, dryRun: true }, neverReadEnvironment);

		assert(parsed.success);

		expect(parsed.data.dryRun).toBeTrue();
	});

	it("should refuse coordinates that name no destination", () => {
		expect.assertions(1);

		const parsed = parseStateMoveOptions(
			{ ...ENV_ONLY, "to-bucket": "my-state" },
			neverReadEnvironment,
		);

		expect(parsed).toStrictEqual({
			err: { flag: "to", kind: "missingRequired" },
			success: false,
		});
	});

	it("should refuse a coordinate flag that names no key", () => {
		expect.assertions(1);

		const parsed = parseStateMoveOptions(
			{ ...ENV_ONLY, "to": "s3", "to-": "my-state" },
			neverReadEnvironment,
		);

		expect(parsed).toStrictEqual({
			err: { flag: "to-", kind: "invalidValue" },
			success: false,
		});
	});

	it.for([
		["to", { to: true }],
		["to", { to: "" }],
		["to-bucket", { "to": "s3", "to-bucket": true }],
		["to-bucket", { "to": "s3", "to-bucket": "" }],
		["dry-run", { "dry-run": "yes" }],
		["force", { force: "yes" }],
	] as const)(
		"should refuse %s when its value is not the shape the flag takes",
		([flag, raw]) => {
			expect.assertions(1);

			const parsed = parseStateMoveOptions({ ...ENV_ONLY, ...raw }, neverReadEnvironment);

			expect(parsed).toStrictEqual({ err: { flag, kind: "invalidValue" }, success: false });
		},
	);

	it("should refuse a flag neither it nor the common parser recognizes", () => {
		expect.assertions(1);

		const parsed = parseStateMoveOptions({ ...ENV_ONLY, nonsense: true }, neverReadEnvironment);

		expect(parsed).toStrictEqual({
			err: { flag: "nonsense", kind: "unknownFlag" },
			success: false,
		});
	});

	it("should refuse a move with no environment to move", () => {
		expect.assertions(1);

		const parsed = parseStateMoveOptions({ to: "s3" }, neverReadEnvironment);

		expect(parsed).toStrictEqual({
			err: { flag: "env", kind: "missingRequired" },
			success: false,
		});
	});
});
