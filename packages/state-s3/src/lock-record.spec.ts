import { describe, expect, it } from "vitest";

import {
	holderOf,
	parseLockRecord,
	type S3LockRecord,
	serializeLockRecord,
} from "./lock-record.ts";

const HELD: S3LockRecord = {
	id: "01J0000000000000000000",
	expiresAt: "2026-08-27T10:01:00.000Z",
	operation: "deploy",
	owner: "ci-run-7",
	since: "2026-08-27T10:00:00.000Z",
};

describe(serializeLockRecord, () => {
	it("should round-trip who holds the environment, what for, since when, and until when", () => {
		expect.assertions(1);

		expect(parseLockRecord(serializeLockRecord(HELD))).toStrictEqual(HELD);
	});

	it("should round-trip the tombstone a release writes", () => {
		expect.assertions(1);

		const released = { ...HELD, releasedAt: "2026-08-27T10:01:00.000Z" };

		expect(parseLockRecord(serializeLockRecord(released))).toStrictEqual(released);
	});
});

describe(parseLockRecord, () => {
	it.for([
		["not json at all", "{ not json"],
		["a json value that is not a record", '"a string"'],
		[
			"a record missing the identity acquisition compares",
			'{"expiresAt":"c","owner":"a","since":"b"}',
		],
		[
			"a record whose identity is blank",
			'{"id":"","expiresAt":"c","operation":"d","owner":"a","since":"b"}',
		],
		[
			"a record carrying no deadline to expire on",
			'{"id":"x","operation":"d","owner":"a","since":"b"}',
		],
		[
			"a record whose tombstone is blank",
			'{"id":"x","expiresAt":"c","operation":"d","owner":"a","releasedAt":"","since":"b"}',
		],
	] as const)("should report %s as no holder rather than as a failure", ([, text]) => {
		expect.assertions(1);

		expect(parseLockRecord(text)).toBeUndefined();
	});
});

describe(holderOf, () => {
	it("should keep only what names the holder to an operator", () => {
		expect.assertions(1);

		expect(holderOf({ ...HELD, releasedAt: "2026-08-27T10:01:00.000Z" })).toStrictEqual({
			expiresAt: "2026-08-27T10:01:00.000Z",
			operation: "deploy",
			owner: "ci-run-7",
			since: "2026-08-27T10:00:00.000Z",
		});
	});
});
