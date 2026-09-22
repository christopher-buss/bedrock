import { describe, expect, it } from "vitest";

import type { LuauExecutionTaskRef } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { LuauExecutionCapacityError } from "./capacity-error.ts";

describe(LuauExecutionCapacityError, () => {
	it("should retain an immutable snapshot of validated blocker references", () => {
		expect.assertions(2);

		const blocker: LuauExecutionTaskRef = {
			placeId: "456",
			sessionId: "11111111-1111-4111-8111-111111111111",
			taskId: "22222222-2222-4222-8222-222222222222",
			universeId: "123",
			versionId: "789",
		};
		const blockers = [blocker];
		const error = new LuauExecutionCapacityError(blockers);
		blockers.push({ ...blocker, taskId: "33333333-3333-4333-8333-333333333333" });

		expect(error.blockers).toStrictEqual([blocker]);
		expect(Object.isFrozen(error.blockers)).toBeTrue();
	});
});
