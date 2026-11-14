import { fromPartial } from "@total-typescript/shoehorn";

import { describe, it } from "vitest";

import {
	badgeCurrent,
	badgeDesired,
	gamePassCurrent,
	gamePassDesired,
} from "#tests/helpers/resources";
import { asResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";
import type { ResolvedConfig } from "./schema.ts";
import type { BedrockState, UnconfirmedPaidCreate } from "./state.ts";
import {
	blockingUnconfirmed,
	withoutConfirmed,
	withoutHeldCreates,
	withoutImported,
} from "./unconfirmed-paid-creates.ts";

const CONFIG = fromPartial<Pick<ResolvedConfig, "badges">>({ badges: { "a-badge": {} } });

function marker(key: string): UnconfirmedPaidCreate {
	return { key: asResourceKey(key), name: key, sentAt: "2026-11-14T15:30:00.000Z" };
}

function stateWith(markers?: ReadonlyArray<UnconfirmedPaidCreate>): BedrockState {
	return {
		environment: "production",
		resources: [],
		...(markers === undefined ? {} : { unconfirmedPaidCreates: markers }),
		version: 1,
	};
}

describe(withoutConfirmed, () => {
	it("should drop the markers of the confirmed keys", ({ expect }) => {
		expect.assertions(1);

		const state = stateWith([marker("a-badge"), marker("b-badge")]);

		expect(withoutConfirmed(state, ["a-badge"])).toStrictEqual(stateWith([marker("b-badge")]));
	});

	it("should keep every marker when no key is confirmed", ({ expect }) => {
		expect.assertions(1);

		const state = stateWith([marker("a-badge")]);

		expect(withoutConfirmed(state, undefined)).toStrictEqual(state);
	});

	it.for([undefined, stateWith()])(
		"should return state without markers as is for %o",
		(state, { expect }) => {
			expect.assertions(1);

			expect(withoutConfirmed(state, ["a-badge"])).toBe(state);
		},
	);
});

describe(blockingUnconfirmed, () => {
	it("should keep only the markers of declared badges", ({ expect }) => {
		expect.assertions(1);

		expect(
			blockingUnconfirmed(CONFIG, {
				unconfirmedPaidCreates: [marker("a-badge"), marker("gone")],
			}),
		).toStrictEqual([marker("a-badge")]);
	});

	it.for([{}, undefined])("should find nothing for %o", (state, { expect }) => {
		expect.assertions(1);

		expect(blockingUnconfirmed(CONFIG, state)).toStrictEqual([]);
	});

	it("should find nothing when the config declares no badges", ({ expect }) => {
		expect.assertions(1);

		expect(
			blockingUnconfirmed({}, { unconfirmedPaidCreates: [marker("a-badge")] }),
		).toStrictEqual([]);
	});
});

describe(withoutImported, () => {
	it("should drop the markers of imported badges only", ({ expect }) => {
		expect.assertions(1);

		const state = stateWith([marker("a-badge"), marker("vip")]);

		expect(
			withoutImported(state, [
				badgeCurrent({ key: asResourceKey("a-badge") }),
				gamePassCurrent({ key: asResourceKey("vip") }),
			]),
		).toStrictEqual(stateWith([marker("vip")]));
	});

	it("should return state without markers as is", ({ expect }) => {
		expect.assertions(1);

		const state = stateWith();

		expect(withoutImported(state, [badgeCurrent()])).toBe(state);
	});
});

describe(withoutHeldCreates, () => {
	it("should drop only the badge creates of held keys", ({ expect }) => {
		expect.assertions(1);

		const key = asResourceKey("a-badge");
		const held: Operation = { key, desired: badgeDesired({ key }), type: "create" };
		const free: Operation = {
			key: asResourceKey("b-badge"),
			desired: badgeDesired({ key: asResourceKey("b-badge") }),
			type: "create",
		};
		const pass: Operation = { key, desired: gamePassDesired({ key }), type: "create" };

		expect(withoutHeldCreates([held, free, pass], [marker("a-badge")])).toStrictEqual([
			free,
			pass,
		]);
	});
});
