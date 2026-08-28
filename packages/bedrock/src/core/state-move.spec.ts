import { assert, describe, expect, it } from "vitest";

import { planStateMove, type StateMoveSurvey } from "./state-move.ts";
import type { BedrockState, StateError, StateRecord } from "./state.ts";

const PRODUCTION: BedrockState = {
	environment: "production",
	resources: [],
	version: 1,
};

const OCCUPYING: BedrockState = {
	environment: "production",
	resources: [],
	version: 1,
};

const UNREADABLE: StateError = {
	file: "state.production.json",
	kind: "stateError",
	reason: "unexpected token at line 1 column 5",
};

const HELD_SOURCE: StateRecord = {
	state: PRODUCTION,
	version: { kind: "present", token: "1" },
};

function surveyOf(record: Partial<StateMoveSurvey>): StateMoveSurvey {
	return {
		destination: { data: { version: { kind: "absent" } }, success: true },
		environment: "production",
		source: { data: HELD_SOURCE, success: true },
		...record,
	};
}

describe(planStateMove, () => {
	it("should fence the move on the absence the destination reported", () => {
		expect.assertions(2);

		const decisions = planStateMove([surveyOf({})], { force: false });
		const decision = decisions.get("production");

		assert(decision !== undefined);
		assert(decision.kind === "move");

		expect(decision.state).toBe(PRODUCTION);
		expect(decision.expected).toStrictEqual({ kind: "absent" });
	});

	it("should leave the write unfenced when the destination names no record", () => {
		expect.assertions(1);

		const decisions = planStateMove([surveyOf({ destination: { data: {}, success: true } })], {
			force: false,
		});
		const decision = decisions.get("production");

		assert(decision !== undefined);
		assert(decision.kind === "move");

		expect(decision.expected).toBeUndefined();
	});

	it("should skip an environment the source holds no state for", () => {
		expect.assertions(1);

		const decisions = planStateMove(
			[surveyOf({ source: { data: { version: { kind: "absent" } }, success: true } })],
			{ force: false },
		);

		expect(decisions.get("production")).toStrictEqual({
			kind: "skip",
			reason: "sourceEmpty",
		});
	});

	it("should block an environment whose source cannot be read", () => {
		expect.assertions(1);

		const decisions = planStateMove(
			[surveyOf({ source: { err: UNREADABLE, success: false } })],
			{ force: false },
		);

		expect(decisions.get("production")).toStrictEqual({
			kind: "blocked",
			reason: { err: UNREADABLE, kind: "sourceUnreadable" },
		});
	});

	it("should block an environment whose destination cannot be read", () => {
		expect.assertions(1);

		const decisions = planStateMove(
			[surveyOf({ destination: { err: UNREADABLE, success: false } })],
			{ force: false },
		);

		expect(decisions.get("production")).toStrictEqual({
			kind: "blocked",
			reason: { err: UNREADABLE, kind: "destinationUnreadable" },
		});
	});

	it("should report the source failure of an environment neither side can read", () => {
		expect.assertions(1);

		const decisions = planStateMove(
			[
				surveyOf({
					destination: { err: UNREADABLE, success: false },
					source: { err: UNREADABLE, success: false },
				}),
			],
			{ force: false },
		);

		expect(decisions.get("production")).toStrictEqual({
			kind: "blocked",
			reason: { err: UNREADABLE, kind: "sourceUnreadable" },
		});
	});

	it("should block a destination that already holds state, carrying what it holds", () => {
		expect.assertions(1);

		const decisions = planStateMove(
			[
				surveyOf({
					destination: {
						data: { state: OCCUPYING, version: { kind: "present", token: "7" } },
						success: true,
					},
				}),
			],
			{ force: false },
		);

		expect(decisions.get("production")).toStrictEqual({
			kind: "blocked",
			reason: { held: OCCUPYING, kind: "destinationOccupied" },
		});
	});

	it("should overwrite an occupied destination unfenced when forced", () => {
		expect.assertions(2);

		const decisions = planStateMove(
			[
				surveyOf({
					destination: {
						data: { state: OCCUPYING, version: { kind: "present", token: "7" } },
						success: true,
					},
				}),
			],
			{ force: true },
		);
		const decision = decisions.get("production");

		assert(decision !== undefined);
		assert(decision.kind === "move");

		expect(decision.state).toBe(PRODUCTION);
		expect(decision.expected).toBeUndefined();
	});

	it("should leave a clean destination's move unfenced when forced", () => {
		expect.assertions(1);

		const decisions = planStateMove([surveyOf({})], { force: true });
		const decision = decisions.get("production");

		assert(decision !== undefined);
		assert(decision.kind === "move");

		expect(decision.expected).toBeUndefined();
	});

	it("should decide every environment it is given", () => {
		expect.assertions(3);

		const decisions = planStateMove(
			[
				surveyOf({}),
				surveyOf({
					environment: "staging",
					source: { data: { version: { kind: "absent" } }, success: true },
				}),
			],
			{ force: false },
		);

		expect(decisions.size).toBe(2);
		expect(decisions.get("production")!.kind).toBe("move");
		expect(decisions.get("staging")!.kind).toBe("skip");
	});
});
