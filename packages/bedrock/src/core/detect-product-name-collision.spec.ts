import { assert, describe, it } from "vitest";

import { developerProductDesired, gamePassDesired } from "#tests/helpers/resources";
import { asResourceKey } from "../types/ids.ts";
import { detectProductNameCollision } from "./detect-product-name-collision.ts";

describe(detectProductNameCollision, () => {
	it("should reject when two developer-product desired entries resolve to the same wire name", ({
		expect,
	}) => {
		expect.assertions(5);

		const first = developerProductDesired({
			key: asResourceKey("bp-1"),
			name: "Hidden Product abcdef",
		});
		const second = developerProductDesired({
			key: asResourceKey("bp-2"),
			name: "Hidden Product abcdef",
		});

		const result = detectProductNameCollision([first, second]);
		assert(!result.success);
		assert(result.err.kind === "redactedNameCollision");

		expect(result.err.resolvedName).toBe("Hidden Product abcdef");
		expect(result.err.keys).toStrictEqual([first.key, second.key]);
		expect(result.err.message).toContain(first.key);
		expect(result.err.message).toContain(second.key);
		expect(result.err.message).toContain("Hidden Product abcdef");
	});

	it("should also reject when the colliding name comes from a user-supplied override rather than the hashed default", ({
		expect,
	}) => {
		expect.assertions(1);

		const first = developerProductDesired({
			key: asResourceKey("a"),
			name: "Closed Beta Pack",
		});
		const second = developerProductDesired({
			key: asResourceKey("b"),
			name: "Closed Beta Pack",
		});

		expect(detectProductNameCollision([first, second]).success).toBeFalse();
	});

	it("should pass through when two developer-products have distinct names", ({ expect }) => {
		expect.assertions(1);

		expect(
			detectProductNameCollision([
				developerProductDesired({ key: asResourceKey("a"), name: "Pack A" }),
				developerProductDesired({ key: asResourceKey("b"), name: "Pack B" }),
			]),
		).toStrictEqual({ data: undefined, success: true });
	});

	it("should not flag a developer-product whose name matches a game-pass name (uniqueness is scoped per kind)", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			detectProductNameCollision([
				developerProductDesired({ name: "Shared Name" }),
				gamePassDesired({ name: "Shared Name" }),
			]),
		).toStrictEqual({ data: undefined, success: true });
	});
});
