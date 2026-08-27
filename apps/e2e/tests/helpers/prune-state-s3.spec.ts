import { describe, expect, it } from "vitest";

import { selectKeysToDelete } from "./prune-state-s3.ts";

const KEYS = [
	"bedrock-smoke/smoke-1000.json",
	"bedrock-smoke/smoke-3000.json",
	"bedrock-smoke/smoke-2000.json",
	"bedrock-smoke/smoke-4000.json",
];

describe(selectKeysToDelete, () => {
	it("should delete the oldest keys once the retention window overflows", () => {
		expect.assertions(1);

		expect(selectKeysToDelete(KEYS, 2)).toStrictEqual([
			"bedrock-smoke/smoke-1000.json",
			"bedrock-smoke/smoke-2000.json",
		]);
	});

	it("should delete nothing while the retention window has room", () => {
		expect.assertions(1);

		expect(selectKeysToDelete(KEYS, 4)).toStrictEqual([]);
	});

	it("should delete nothing when the store is empty", () => {
		expect.assertions(1);

		expect(selectKeysToDelete([], 3)).toStrictEqual([]);
	});

	it("should delete every key when nothing is retained", () => {
		expect.assertions(1);

		expect(selectKeysToDelete(KEYS, 0)).toHaveLength(4);
	});
});
