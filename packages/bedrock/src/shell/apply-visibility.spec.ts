import { OpenCloudError } from "@bedrock-rbx/ocale";

import { assert, describe, it, vi } from "vitest";

import {
	gamePassCurrent,
	gamePassDesired,
	universeCurrent,
	universeDesired,
} from "#tests/helpers/resources";
import { diff } from "../core/diff.ts";
import type { ProgressEvent } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { applyOps } from "./apply-ops.ts";

function fixture(fail?: "resource" | "visibility", failedUniverseId?: string) {
	const events: Array<string> = [];
	const registry: DriverRegistry = {
		developerProduct: {
			async create() {
				throw new Error("unused");
			},
		},
		gamePass: {
			async create(desired) {
				events.push("pass");
				return {
					data: {
						...desired,
						outputs: {
							assetId: asRobloxAssetId("100"),
							iconAssetIds: { "en-us": asRobloxAssetId("101") },
						},
					},
					success: true,
				};
			},
		},
		place: {
			async create() {
				throw new Error("unused");
			},
		},
		universe: {
			async create(desired) {
				events.push("universe");
				return fail === "resource" &&
					(failedUniverseId === undefined || desired.universeId === failedUniverseId)
					? { err: new OpenCloudError("resource failed"), success: false }
					: { data: { ...desired, outputs: universeCurrent().outputs }, success: true };
			},
			async setVisibility(_id, visibility) {
				events.push(visibility);
				return fail === "visibility"
					? { err: new OpenCloudError("unconfirmed"), success: false }
					: { data: undefined, success: true };
			},
			async update(_current, desired) {
				return this.create(desired);
			},
		},
	};
	return { events, registry };
}

describe("apply visibility ordering", () => {
	it.for([
		["private", ["private", "universe"]],
		["public", ["universe", "public"]],
	] as const)(
		"should untrack without a driver beside a %s transition",
		async ([target, expected], { expect }) => {
			expect.hasAssertions();

			const { events, registry } = fixture();
			const progress: Array<ProgressEvent> = [];
			const current = gamePassCurrent();
			const result = await applyOps(
				[
					...diff([universeDesired({ visibility: target })], []),
					{ key: current.key, current, type: "untrack" },
				],
				registry,
				{
					environment: "production",
					progress: {
						emit: (event) => {
							progress.push(event);
						},
					},
				},
			);

			expect(result.success).toBeTrue();
			expect(events).toStrictEqual(expected);
			expect(progress.filter((event) => event.kind === "applySummary")).toMatchObject([
				{ created: 1, failed: 0, untracked: 1 },
			]);
		},
	);

	it("should withhold untrack operations when the required private transition fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { events, registry } = fixture("visibility");
		const progress: Array<ProgressEvent> = [];
		const current = gamePassCurrent();
		const result = await applyOps(
			[
				...diff([universeDesired({ visibility: "private" })], []),
				{ key: current.key, current, type: "untrack" },
			],
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						progress.push(event);
					},
				},
			},
		);

		expect(result.success).toBeFalse();
		expect(events).toStrictEqual(["private"]);
		expect(progress.filter((event) => event.kind === "applySummary")).toMatchObject([
			{ created: 0, failed: 1, untracked: 0 },
		]);
	});

	it("should update ordinary fields without repeating a confirmed visibility write", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { events, registry } = fixture();
		const result = await applyOps(
			diff(
				[universeDesired({ displayName: "New", visibility: "public" })],
				[universeCurrent({ displayName: "Old", visibility: "public" })],
			),
			registry,
		);

		expect(result.success).toBeTrue();
		expect(events).toStrictEqual(["universe"]);
	});

	it("should confirm each universe independently without duplicating successful updates", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture();
		const desired = [
			universeDesired({
				key: asResourceKey("private"),
				universeId: asRobloxAssetId("111"),
				visibility: "private",
			}),
			universeDesired({
				key: asResourceKey("public"),
				universeId: asRobloxAssetId("222"),
				visibility: "public",
			}),
		];
		const current = [
			universeCurrent({
				key: asResourceKey("private"),
				universeId: asRobloxAssetId("111"),
				visibility: "public",
			}),
			universeCurrent({
				key: asResourceKey("public"),
				universeId: asRobloxAssetId("222"),
				visibility: "private",
			}),
		];
		const result = await applyOps(diff(desired, current), registry);
		assert(result.success);

		expect(result.data).toStrictEqual(
			desired.map((value) => ({ ...value, outputs: universeCurrent().outputs })),
		);
	});

	it("should retain a failed universe's private confirmation beside another universe's ordinary success", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("resource", "111");

		const desired = [
			universeDesired({
				key: asResourceKey("private"),
				universeId: asRobloxAssetId("111"),
				visibility: "private",
			}),
			universeDesired({
				key: asResourceKey("public"),
				universeId: asRobloxAssetId("222"),
				visibility: "public",
			}),
		];
		const current = [
			universeCurrent({
				key: asResourceKey("private"),
				universeId: asRobloxAssetId("111"),
				visibility: "public",
			}),
			universeCurrent({
				key: asResourceKey("public"),
				universeId: asRobloxAssetId("222"),
				visibility: "private",
			}),
		];
		const result = await applyOps(diff(desired, current), registry);
		assert(!result.success);

		expect(result.err.applied).toMatchObject([
			{ universeId: "222" },
			{ universeId: "111", visibility: "private" },
		]);
		expect(result.err.applied[0]).not.toHaveProperty("visibility");
	});

	it("should retain confirmation for the new universe without relabeling the old snapshot after failure", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("resource");
		const desired = universeDesired({
			universeId: asRobloxAssetId("222"),
			visibility: "private",
		});
		const current = universeCurrent({
			universeId: asRobloxAssetId("111"),
			visibility: "public",
		});
		const result = await applyOps(diff([desired], [current]), registry);

		expect(result).toMatchObject({
			err: {
				applied: [],
				visibility: [{ status: "confirmed", target: "private", universeId: "222" }],
			},
			success: false,
		});
	});

	it.for([
		["private", ["private", "universe", "pass"]],
		["public", ["universe", "pass", "public"]],
	] as const)(
		"should order %s around the supplied batch",
		async ([visibility, order], { expect }) => {
			expect.hasAssertions();

			const { events, registry } = fixture();
			const result = await applyOps(
				diff([universeDesired({ visibility }), gamePassDesired()], []),
				registry,
			);

			assert(result.success);

			expect(events).toStrictEqual(order);
			expect(result.data[0]).toMatchObject({ visibility });
			expect(result.data[1]).not.toHaveProperty("visibility");
		},
	);

	it("should stop all resource changes when private cannot be confirmed", async ({ expect }) => {
		expect.hasAssertions();

		const { events, registry } = fixture("visibility");
		const result = await applyOps(
			diff([universeDesired({ visibility: "private" }), gamePassDesired()], []),
			registry,
		);

		expect(events).toStrictEqual(["private"]);
		expect(result).toMatchObject({
			err: { applied: [], visibility: [{ status: "unresolved", target: "private" }] },
			success: false,
		});
	});

	it("should defer public after failure and preserve confirmed ordinary fields", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { events, registry } = fixture("resource");
		const result = await applyOps(
			diff([universeDesired({ visibility: "public" }), gamePassDesired()], []),
			registry,
		);

		expect(events).toStrictEqual(["universe", "pass"]);
		expect(result).toMatchObject({
			err: { visibility: [{ status: "deferred", target: "public" }] },
			success: false,
		});
	});

	it("should preserve ordinary universe success when public is unconfirmed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("visibility");
		const result = await applyOps(
			diff(
				[universeDesired({ displayName: "New", visibility: "public" })],
				[universeCurrent({ visibility: "private" })],
			),
			registry,
		);

		expect(result).toMatchObject({
			err: {
				applied: [{ displayName: "New" }],
				visibility: [{ status: "unresolved", target: "public" }],
			},
			success: false,
		});

		assert(!result.success);

		expect(result.err.applied[0]).not.toHaveProperty("visibility");
	});
});

describe("visibility progress", () => {
	it("should report the requested universe key on visibility progress and failure", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("visibility");
		const events: Array<ProgressEvent> = [];
		await applyOps(
			diff([universeDesired({ key: asResourceKey("custom"), visibility: "private" })], []),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events).toMatchObject([
			{ key: "custom", kind: "resourceOpStarted" },
			{ key: "custom", error: { key: "custom" }, kind: "resourceOpFailed" },
			{ failed: 1, kind: "applySummary" },
		]);
	});

	it("should report ordinary failures and exclude partial failed operations from completed totals", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("resource");
		const events: Array<ProgressEvent> = [];
		await applyOps(
			diff(
				[
					universeDesired({ displayName: "New", visibility: "private" }),
					gamePassDesired({ key: universeDesired().key }),
				],
				[universeCurrent({ visibility: "public" })],
			),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpFailed", resourceKind: "universe" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpSucceeded", resourceKind: "gamePass" }),
		);
		expect(events.at(-1)).toMatchObject({
			created: 1,
			failed: 1,
			kind: "applySummary",
			updated: 0,
		});
	});

	it("should exclude operations skipped by a failed private gate from completed totals", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("visibility");
		const events: Array<ProgressEvent> = [];
		await applyOps(
			diff([universeDesired({ visibility: "private" }), gamePassDesired()], []),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events.at(-1)).toMatchObject({
			created: 0,
			failed: 1,
			kind: "applySummary",
			updated: 0,
		});
	});

	it("should report mixed operation totals and duration including the final visibility transition", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		onTestFinished(() => {
			clock.mockRestore();
		});
		const { registry } = fixture();
		registry.universe.setVisibility = async () => {
			clock.mockReturnValue(1500);
			return { data: undefined, success: true };
		};

		const events: Array<ProgressEvent> = [];
		const desired = [
			universeDesired({ visibility: "public" }),
			gamePassDesired({ key: asResourceKey("new") }),
			gamePassDesired(),
		];
		await applyOps(
			diff(desired, [universeCurrent({ visibility: "private" }), gamePassCurrent()]),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events.at(-1)).toStrictEqual({
			created: 1,
			durationMs: 500,
			environment: "production",
			failed: 0,
			kind: "applySummary",
			noop: 1,
			untracked: 0,
			updated: 1,
		});
	});

	it.for(["private", "public"] as const)(
		"should emit one failed footer after a failed %s transition",
		async (visibility, { expect }) => {
			expect.hasAssertions();

			const { registry } = fixture("visibility");
			const events: Array<ProgressEvent> = [];
			await applyOps(diff([universeDesired({ visibility })], []), registry, {
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			});

			expect(events.filter((event) => event.kind === "applySummary")).toHaveLength(1);
			expect(events.at(-1)).toMatchObject({
				created: 0,
				failed: 1,
				kind: "applySummary",
				noop: 0,
				updated: 0,
			});
		},
	);

	it("should count a split universe operation once in its final footer", async ({ expect }) => {
		expect.hasAssertions();

		const { registry } = fixture();
		const events: Array<ProgressEvent> = [];
		await applyOps(
			diff([universeDesired({ visibility: "public" }), gamePassDesired()], []),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events.filter((event) => event.kind === "applySummary")).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({
			created: 2,
			failed: 0,
			kind: "applySummary",
			noop: 0,
			updated: 0,
		});
	});

	it("should count successful resources independently of a failing kind with the same key", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("resource");
		const events: Array<ProgressEvent> = [];
		await applyOps(
			diff(
				[
					universeDesired({ visibility: "public" }),
					gamePassDesired({ key: universeDesired().key }),
				],
				[],
			),
			registry,
			{
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
			},
		);

		expect(events.at(-1)).toMatchObject({
			created: 1,
			failed: 1,
			kind: "applySummary",
			updated: 0,
		});
	});

	it("should report a failed transition through the progress port", async ({ expect }) => {
		expect.hasAssertions();

		const { registry } = fixture("visibility");
		const events: Array<unknown> = [];
		const result = await applyOps(
			diff([universeDesired({ visibility: "private" })], []),
			registry,
			{
				environment: "production",
				progress: {
					emit(event) {
						events.push(event);
					},
				},
			},
		);

		expect(result.success).toBeFalse();
		expect(events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpStarted", resourceKind: "universe" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpFailed", resourceKind: "universe" }),
		);
	});
});

describe("visibility adapter capability failures", () => {
	it("should return an unresolved private gate for a driver without visibility support", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { events, registry } = fixture();
		delete registry.universe.setVisibility;
		const result = await applyOps(
			diff([universeDesired({ visibility: "private" }), gamePassDesired()], []),
			registry,
		);

		expect(result).toMatchObject({
			err: { visibility: [{ status: "unresolved" }] },
			success: false,
		});
		expect(events).toStrictEqual([]);

		assert(!result.success && result.err.failures[0].kind === "driverFailure");

		expect(result.err.failures[0].cause.message).toBe(
			"The universe driver does not support visibility transitions",
		);
	});

	it("should retain uncertainty when a visibility adapter throws", async ({ expect }) => {
		expect.hasAssertions();

		const { events, registry } = fixture();
		const cause = new Error("process interrupted after request");
		registry.universe.setVisibility = async () => {
			throw cause;
		};

		const result = await applyOps(
			diff([universeDesired({ visibility: "private" })], []),
			registry,
		);

		expect(result).toMatchObject({
			err: { applied: [], visibility: [{ status: "unresolved" }] },
			success: false,
		});
		expect(events).toStrictEqual([]);

		assert(!result.success && result.err.failures[0].kind === "driverFailure");

		expect(result.err.failures[0].cause.message).toBe("Universe visibility transition threw");
		expect(result.err.failures[0].cause.cause).toBe(cause);
	});

	it("should retain confirmed private even when ordinary universe fields fail", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture("resource");
		const result = await applyOps(
			diff(
				[universeDesired({ displayName: "New", visibility: "private" })],
				[universeCurrent({ displayName: "Old", visibility: "public" })],
			),
			registry,
		);

		expect(result).toMatchObject({
			err: {
				applied: [{ displayName: "Old", visibility: "private" }],
				visibility: [{ status: "confirmed" }],
			},
			success: false,
		});
	});

	it("should report confirmed public visibility through the progress port", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { registry } = fixture();
		const events: Array<unknown> = [];
		const result = await applyOps(
			diff([universeDesired({ visibility: "public" })], []),
			registry,
			{
				environment: "production",
				progress: {
					emit(event) {
						events.push(event);
					},
				},
			},
		);

		expect(result.success).toBeTrue();
		expect(events).toContainEqual(
			expect.objectContaining({ changedFields: ["visibility"], kind: "resourceOpSucceeded" }),
		);
	});
});
