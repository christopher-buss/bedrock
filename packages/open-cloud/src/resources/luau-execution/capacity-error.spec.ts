import { assert, describe, expect, it } from "vitest";

import type { LuauExecutionTaskRef } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import { capacityErrorFrom, LuauExecutionCapacityError } from "./capacity-error.ts";

const parameters = {
	placeId: "456",
	script: "return 1",
	universeId: "123",
};

const jsonNull: JSONValue = JSON.parse("null");

const blocker: LuauExecutionTaskRef = {
	placeId: "456",
	sessionId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	universeId: "123",
	versionId: "789",
};

function blockerPath(ref: LuauExecutionTaskRef): string {
	return `universes/${ref.universeId}/places/${ref.placeId}/versions/${ref.versionId}/luau-execution-sessions/${ref.sessionId}/tasks/${ref.taskId}`;
}

function rateLimit(details: JSONValue | undefined, code = "RESOURCE_EXHAUSTED"): RateLimitError {
	return new RateLimitError("Rate limited", { code, details, retryAfterSeconds: 1 });
}

describe(LuauExecutionCapacityError, () => {
	it("should retain an immutable snapshot of validated blocker references", () => {
		expect.assertions(5);

		const blockers = [blocker];
		const error = new LuauExecutionCapacityError(blockers);
		blockers.push({ ...blocker, taskId: "33333333-3333-4333-8333-333333333333" });

		expect(error.blockers).toStrictEqual([blocker]);
		expect(Object.isFrozen(error.blockers)).toBeTrue();
		expect(error.name).toBe("LuauExecutionCapacityError");
		expect(error.message).toBe("Luau execution capacity is occupied");
		expect(error.code).toBe("RESOURCE_EXHAUSTED");
	});
});

describe(capacityErrorFrom, () => {
	it.for([
		new ApiError("Not rate limited", { code: "RESOURCE_EXHAUSTED", statusCode: 429 }),
		rateLimit(
			{ code: "RESOURCE_EXHAUSTED", message: blockerPath(blocker) },
			"TOO_MANY_REQUESTS",
		),
	])("should reject a failure without the outer capacity classification", (error) => {
		expect.assertions(1);

		expect(capacityErrorFrom(error, parameters)).toBeUndefined();
	});

	it.for([
		undefined,
		jsonNull,
		"RESOURCE_EXHAUSTED",
		[],
		{},
		{ code: "QUOTA_EXHAUSTED", message: blockerPath(blocker) },
		{ code: "RESOURCE_EXHAUSTED", message: 42 },
	])("should reject malformed capacity details: %j", (details) => {
		expect.assertions(1);

		expect(capacityErrorFrom(rateLimit(details), parameters)).toBeUndefined();
	});

	it("should treat submitted identifiers as literal text while matching blockers", () => {
		expect.assertions(1);

		const specialParameters = {
			placeId: "456[7]",
			script: "return 1",
			universeId: "123.+?",
		};
		const specialBlocker = {
			...blocker,
			placeId: specialParameters.placeId,
			universeId: specialParameters.universeId,
		};
		const result = capacityErrorFrom(
			rateLimit({
				code: "RESOURCE_EXHAUSTED",
				message: blockerPath(specialBlocker),
			}),
			specialParameters,
		);

		assert(result !== undefined);

		expect(result.blockers).toStrictEqual([specialBlocker]);
	});
});
