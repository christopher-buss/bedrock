import { OpenCloudError } from "@bedrock-rbx/ocale";

import { assert, describe, it } from "vitest";

import {
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import type { ConfigRootUniverseId } from "../core/schema.ts";
import { parseStateContents, serializeStateFile } from "../core/state-file.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { deploy, provision, publish } from "./deploy.ts";

function roundTripState(state: BedrockState): BedrockState {
	const parsed = parseStateContents(serializeStateFile(state), "state.json");
	assert(parsed.success);
	return parsed.data;
}

function fixture(visibility: "private" | "public" | undefined = "public", artifacts = false) {
	const events: Array<string> = [];
	let state: BedrockState | undefined;
	let fail: string | undefined;
	let writes = 0;
	let reads = 0;
	let revision = 0;
	let conflictRead: number | undefined;
	let roundTrip = false;
	let missingRead: number | undefined;
	const config: ConfigRootUniverseId = {
		environments: { production: artifacts ? { places: { start: { placeId: "4711" } } } : {} },
		universe: { universeId: "1234567890", visibility },
		...(artifacts ? { places: { start: { filePath: "game.rbxl" } } } : {}),
	};
	const port: StatePort = {
		async read() {
			reads += 1;
			if (reads === missingRead) {
				state = undefined;
				revision += 1;
			}

			if (reads === conflictRead && state !== undefined) {
				revision += 1;
				state = { ...state, resources: [...state.resources, gamePassCurrent()] };
			}

			if (fail === `read:${reads}`) {
				return {
					err: { file: "state.json", kind: "stateError", reason: "read failed" },
					success: false,
				};
			}

			const snapshot = roundTrip && state !== undefined ? roundTripState(state) : state;
			return state === undefined
				? { data: { version: { kind: "absent" } }, success: true }
				: {
						data: {
							state: snapshot ?? state,
							version: { kind: "present", token: String(revision) },
						},
						success: true,
					};
		},
		async write(next, expected) {
			writes += 1;
			if (fail === "state" || fail === `write:${writes}`) {
				return {
					err: { file: "state.json", kind: "stateError", reason: "write failed" },
					success: false,
				};
			}

			assert(expected?.kind === (state === undefined ? "absent" : "present"));
			if (expected.kind === "present") {
				assert(expected.token === String(revision));
			}

			revision += 1;
			state = next;
			events.push("checkpoint");
			return { data: undefined, success: true };
		},
	};
	const registry: DriverRegistry = {
		developerProduct: {
			async create(desired) {
				events.push("product");
				return {
					data: { ...desired, outputs: developerProductCurrent().outputs },
					success: true,
				};
			},
		},
		gamePass: {
			async create(desired) {
				events.push("pass");
				return { data: { ...desired, outputs: gamePassCurrent().outputs }, success: true };
			},
		},
		place: {
			async create(desired) {
				events.push("publish");
				return fail === "publish"
					? { err: new OpenCloudError("publish failed"), success: false }
					: { data: { ...desired, outputs: placeCurrent().outputs }, success: true };
			},
			async update(_current, desired) {
				return this.create(desired);
			},
		},
		universe: {
			async create(desired) {
				events.push("universe");
				return fail === "resource"
					? { err: new OpenCloudError("resource failed"), success: false }
					: { data: { ...desired, outputs: universeCurrent().outputs }, success: true };
			},
			async setVisibility(_id, target) {
				events.push(target);
				return fail === "visibility"
					? { err: new OpenCloudError("unknown"), success: false }
					: { data: undefined, success: true };
			},
			async update(_current, desired) {
				return this.create(desired);
			},
		},
	};
	const options = {
		config,
		environment: "production",
		progress: { emit() {} },
		readFile: async () => new Uint8Array(),
		registry,
		statePort: port,
	};
	return {
		conflictOnRead: (value: number) => {
			conflictRead = value;
		},
		events,
		fail: (value: string | undefined) => {
			fail = value;
		},
		getState: () => state,
		loseStateOnRead: (value: number) => {
			missingRead = value;
		},
		options,
		roundTripReads: () => {
			roundTrip = true;
		},
		setState: (value: BedrockState) => {
			state = value;
		},
	};
}

describe("visibility deployment boundaries", () => {
	it("should checkpoint resource work and intent before public activation", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture();
		const result = await deploy(harness.options);
		assert(result.success);

		expect(harness.events.indexOf("public")).toBeGreaterThan(
			harness.events.indexOf("universe"),
		);
		expect(harness.events[harness.events.indexOf("public") - 1]).toBe("checkpoint");
		expect(harness.getState()!.resources[0]).toMatchObject({ visibility: "public" });
		expect(result.data).not.toHaveProperty("universeVisibility");
		expect(harness.getState()).not.toHaveProperty("universeVisibility");
	});

	it("should enforce private before ordinary resource work and stop on uncertainty", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.fail("visibility");
		const result = await deploy(harness.options);

		expect(result.success).toBeFalse();
		expect(result).toMatchObject({
			err: {
				cause: {
					visibility: [
						{ status: "unresolved", target: "private", universeId: "1234567890" },
					],
				},
			},
		});
		expect(harness.events).toStrictEqual(["checkpoint", "private"]);
		expect(harness.getState()!.universeVisibility).toMatchObject({
			status: "intent",
			target: "private",
		});
	});

	it("should never send a transition after an intent checkpoint fails", async ({ expect }) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.fail("state");
		const result = await deploy(harness.options);

		expect(result).toMatchObject({
			err: {
				cause: { kind: "stateError", reason: "write failed" },
				kind: "stateWriteFailed",
			},
			success: false,
		});
		expect(harness.events).toStrictEqual([]);
	});

	it("should defer standalone provision until matching publish succeeds", async ({ expect }) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));

		expect(harness.events).not.toContain("public");
		expect(harness.getState()!.universeVisibility).toMatchObject({ status: "deferred" });

		const result = await publish(harness.options);

		expect(result.success).toBeTrue();
		expect(harness.events.indexOf("public")).toBeGreaterThan(harness.events.indexOf("publish"));
	});

	it("should reject activation after failed provision even with pending rebuild", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		harness.fail("resource");

		await expect(provision(harness.options)).resolves.toMatchObject({ success: false });

		harness.fail(undefined);

		await expect(publish(harness.options)).resolves.toMatchObject({
			err: { cause: { visibility: [{ status: "deferred", target: "public" }] } },
			success: false,
		});
		expect(harness.events).not.toContain("public");
	});

	it("should forget ownership on omission and reconcile when visibility is restored", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture();
		assertSuccess(await deploy(harness.options));
		const omitted = {
			...harness.options,
			config: { ...harness.options.config, universe: { universeId: "1234567890" } },
		};
		assertSuccess(await deploy(omitted));

		expect(harness.getState()!.resources[0]).not.toHaveProperty("visibility");

		assertSuccess(await deploy(harness.options));

		expect(harness.events.filter((event) => event === "public")).toHaveLength(2);
	});

	it("should reconcile previous public after uncertain private despite the old snapshot", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			universeVisibility: { status: "intent", target: "private", universeId: "1234567890" },
			version: 1,
		});
		const config = {
			...harness.options.config,
			universe: { universeId: "1234567890", visibility: "public" as const },
		};
		assertSuccess(await deploy({ ...harness.options, config }));

		expect(harness.events).toContain("public");
	});
});

function assertSuccess(result: { readonly success: boolean }): void {
	assert(result.success);
}

describe("visibility failure recovery", () => {
	it("should withhold public after provision, codegen, build, and publishing failures", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const stages = ["resource", "codegen", "build", "publish"];
		const activations: Array<string> = [];
		for (const stage of stages) {
			const harness = fixture("public", true);
			harness.fail(stage);
			const result = await deploy({
				...harness.options,
				build: failBuild(stage),
				codegenWriter: {
					async write() {
						return { data: undefined, success: true };
					},
				},
				config: { ...harness.options.config, codegen: { enabled: true } },
				emit: failCodegen(stage),
			});
			activations.push(`${stage}:${result.success}:${harness.events.includes("public")}`);
		}

		expect(activations).toStrictEqual([
			"resource:false:false",
			"codegen:false:false",
			"build:false:false",
			"publish:false:false",
		]);
	});

	it("should retain confirmed private when later resource work fails", async ({ expect }) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			version: 1,
		});
		harness.fail("resource");
		const config = {
			...harness.options.config,
			universe: {
				displayName: "Changed",
				universeId: "1234567890",
				visibility: "private" as const,
			},
		};
		const result = await deploy({ ...harness.options, config });

		expect(result.success).toBeFalse();
		expect(harness.getState()!.resources[0]).toMatchObject({ visibility: "private" });
	});

	it("should keep an already-public experience public during failed updates", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			version: 1,
		});
		harness.fail("resource");
		const config = {
			...harness.options.config,
			universe: {
				displayName: "Changed",
				universeId: "1234567890",
				visibility: "public" as const,
			},
		};
		const result = await deploy({ ...harness.options, config });

		expect(result.success).toBeFalse();
		expect(harness.events).not.toContain("public");
		expect(harness.events).not.toContain("private");
	});

	it("should return confirmed visibility in recovery after its final write fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			version: 1,
		});
		harness.fail("write:2");
		const result = await deploy(harness.options);

		expect(result).toMatchObject({
			err: {
				kind: "stateWriteFailed",
				unsavedState: { resources: [{ visibility: "private" }] },
			},
			success: false,
		});
		expect(harness.events).toStrictEqual(["checkpoint", "private"]);
	});

	it("should reject a stale preparation for a changed configuration or universe", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));
		const config = {
			...harness.options.config,
			universe: { universeId: "999", visibility: "public" as const },
		};
		const result = await publish({ ...harness.options, config });

		expect(result.success).toBeFalse();
		expect(harness.events).not.toContain("public");
	});

	it("should cancel deferred activation on omission between stages", async ({ expect }) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));
		const config = { ...harness.options.config, universe: { universeId: "1234567890" } };
		assertSuccess(await publish({ ...harness.options, config }));

		expect(harness.getState()).not.toHaveProperty("universeVisibility");
		expect(harness.events).not.toContain("public");
	});

	it("should retain unknown remote outcomes across omission and re-management", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			universeVisibility: { status: "intent", target: "private", universeId: "1234567890" },
			version: 1,
		});
		const unmanaged = { ...harness.options.config, universe: { universeId: "1234567890" } };
		assertSuccess(await deploy({ ...harness.options, config: unmanaged }));

		expect(harness.getState()!.universeVisibility).toMatchObject({
			status: "intent",
			target: "private",
		});

		const config = {
			...harness.options.config,
			universe: { universeId: "1234567890", visibility: "public" as const },
		};
		assertSuccess(await deploy({ ...harness.options, config }));

		expect(harness.events).toContain("public");
	});

	it("should satisfy owed publishing with unchanged artifacts without another upload", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await deploy(harness.options));
		const first = harness.events.filter((event) => event === "publish").length;
		const config = { ...harness.options.config, universe: { universeId: "1234567890" } };
		assertSuccess(await deploy({ ...harness.options, config }));
		assertSuccess(await provision(harness.options));
		assertSuccess(await publish(harness.options));

		expect(harness.events.filter((event) => event === "publish")).toHaveLength(first);
		expect(harness.getState()!.resources[0]).toMatchObject({ visibility: "public" });
	});

	it("should report only the transition absent from prior checkpoints as unrecorded", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" }), placeCurrent()],
			version: 1,
		});
		harness.fail("write:2");
		const result = await deploy(harness.options);
		assert(!result.success && result.err.kind === "stateWriteFailed");

		expect(result.err.unrecorded).toHaveLength(1);
		expect(result.err.unrecorded[0]).toMatchObject({ kind: "universe", visibility: "private" });
	});
});

function failBuild(stage: string): () => Promise<void> {
	return async () => {
		if (stage === "build") {
			throw new Error("build failed");
		}
	};
}

function failCodegen(stage: string): () => Promise<[]> {
	return async () => {
		if (stage === "codegen") {
			throw new Error("codegen failed");
		}

		return [];
	};
}

describe("visibility checkpoint and retry recovery", () => {
	it("should withhold a transition when its persisted intent disappears", async ({ expect }) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.loseStateOnRead(2);
		const result = await deploy(harness.options);

		expect(result).toMatchObject({ err: { cause: { kind: "stateConflict" } }, success: false });
		expect(harness.events).not.toContain("private");
	});

	it("should report a failed deferred-activation checkpoint without sending a request", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		harness.fail("write:2");
		const result = await publish(harness.options);

		expect(result).toMatchObject({ err: { kind: "stateWriteFailed" }, success: false });
		expect(harness.events).not.toContain("public");
	});

	it("should preserve an unmanaged read failure without attempting a write", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture();
		harness.fail("read:1");
		const config = { ...harness.options.config, universe: { universeId: "1234567890" } };
		const result = await deploy({ ...harness.options, config });

		expect(result).toMatchObject({ err: { kind: "stateReadFailed" }, success: false });
		expect(harness.events).toStrictEqual([]);
	});

	it("should accept adapter roundtrip normalization when refreshing a checkpoint", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			pendingRebuild: new Set(),
			resources: [universeCurrent({ visibility: "public" })],
			version: 1,
		});
		harness.roundTripReads();
		const result = await deploy(harness.options);

		expect(result.success).toBeTrue();
		expect(harness.events).toContain("private");
	});

	it.for([2, 3, 4, 5, 6, 7])(
		"should reject a concurrent snapshot at visibility checkpoint read %s",
		async (read, { expect }) => {
			expect.hasAssertions();

			const harness = fixture("public");
			harness.conflictOnRead(read);
			const result = await deploy(harness.options);

			expect(result).toMatchObject({
				err: {
					cause: {
						kind: "stateConflict",
						reason: "State changed after the visibility checkpoint",
					},
				},
				success: false,
			});
			expect(harness.getState()!.resources).toContainEqual(gamePassCurrent());
			expect(harness.events.includes("public")).toBe(read === 7);
		},
	);

	it("should reuse confirmed private on a retry after ordinary fields failed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.fail("resource");
		const failed = await deploy(harness.options);

		expect(failed.success).toBeFalse();

		harness.fail(undefined);
		assertSuccess(await deploy(harness.options));

		expect(harness.events.filter((event) => event === "private")).toHaveLength(1);
	});

	it("should checkpoint completed products and passes before activation retries", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public");
		const config = {
			...harness.options.config,
			passes: { vip: { name: "VIP", description: "Perks", icon: { "en-us": "icon.png" } } },
			products: { coins: { name: "Coins", description: "Currency" } },
		};
		harness.fail("visibility");
		const failed = await deploy({ ...harness.options, config });

		expect(failed.success).toBeFalse();

		harness.fail(undefined);
		assertSuccess(await deploy({ ...harness.options, config }));

		expect(harness.events.filter((event) => event === "pass")).toHaveLength(1);
		expect(harness.events.filter((event) => event === "product")).toHaveLength(1);
	});

	it.for([1, 2, 3])(
		"should send no public request when prerequisite write %s fails",
		async (write, { expect }) => {
			expect.hasAssertions();

			const harness = fixture("public");
			harness.fail(`write:${write}`);
			const result = await deploy(harness.options);

			expect(result).toMatchObject({
				err: {
					cause: { kind: "stateError", reason: "write failed" },
					kind: "stateWriteFailed",
				},
				success: false,
			});
			expect(harness.events).not.toContain("public");
		},
	);

	it.for([4, 5])(
		"should recover confirmed public when final write %s fails",
		async (write, { expect }) => {
			expect.hasAssertions();

			const harness = fixture("public");
			harness.fail(`write:${write}`);
			const result = await deploy(harness.options);

			expect(result).toMatchObject({
				err: {
					kind: "stateWriteFailed",
					unsavedState: { resources: [{ visibility: "public" }] },
				},
				success: false,
			});
			expect(harness.events).toContain("public");
		},
	);

	it.for([1, 2, 3, 4, 5])(
		"should withhold activation when state read %s fails",
		async (read, { expect }) => {
			expect.hasAssertions();

			const harness = fixture("public");
			harness.fail(`read:${read}`);
			const result = await deploy(harness.options);

			expect(result.success).toBeFalse();
			expect(harness.events).not.toContain("public");
		},
	);

	it("should retain historical uncertainty in an unmanaged recovery snapshot", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		harness.setState({
			environment: "production",
			resources: [universeCurrent({ visibility: "public" })],
			universeVisibility: { status: "intent", target: "private", universeId: "1234567890" },
			version: 1,
		});
		harness.fail("state");
		const config = { ...harness.options.config, universe: { universeId: "1234567890" } };
		const result = await deploy({ ...harness.options, config });

		expect(result).toMatchObject({
			err: {
				kind: "stateWriteFailed",
				unsavedState: { universeVisibility: { status: "intent", target: "private" } },
			},
			success: false,
		});
	});
});

describe("confirmed visibility and preparation boundaries", () => {
	it("should trust only the matching universe and preserve unrelated current resources", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture();
		const pass = gamePassCurrent();
		const orphan = universeCurrent({
			key: asResourceKey("former"),
			universeId: asRobloxAssetId("999"),
			visibility: "private",
		});
		const current = universeCurrent({ visibility: "public" });
		harness.setState({
			environment: "production",
			resources: [pass, orphan, current],
			version: 1,
		});
		const result = await deploy(harness.options);
		assert(result.success);

		expect(result.data.resources).toStrictEqual([pass, orphan, current]);
		expect(harness.events).not.toContain("public");
		expect(harness.events).not.toContain("private");
	});

	it("should establish private exactly once and complete without a visibility journal", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		const result = await deploy(harness.options);
		assert(result.success);

		expect(harness.events.filter((event) => event === "private")).toHaveLength(1);
		expect(result.data).not.toHaveProperty("universeVisibility");
		expect(result.data.resources).toContainEqual(universeCurrent({ visibility: "private" }));
	});

	it("should report only the matching universe as an unrecorded visibility transition", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("private");
		const orphan = universeCurrent({
			key: asResourceKey("former"),
			universeId: asRobloxAssetId("999"),
			visibility: "public",
		});
		harness.setState({
			environment: "production",
			resources: [orphan, universeCurrent({ visibility: "public" })],
			version: 1,
		});
		harness.fail("write:2");
		const result = await deploy(harness.options);
		assert(!result.success && result.err.kind === "stateWriteFailed");

		expect(result.err.unrecorded).toStrictEqual([universeCurrent({ visibility: "private" })]);
		expect(result.err.unsavedState.resources).toContainEqual(orphan);
	});

	it("should retain successful preparation until owed place publishing completes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));
		const prepared = harness.getState()!.universeVisibility;
		let preparationAtPublish: BedrockState["universeVisibility"];
		const { place } = harness.options.registry;
		const result = await publish({
			...harness.options,
			registry: {
				...harness.options.registry,
				place: {
					async create(desired, context) {
						preparationAtPublish = harness.getState()!.universeVisibility;
						return place.create(desired, context);
					},
				},
			},
		});
		assert(result.success);

		expect(prepared).toHaveProperty("preparation");
		expect(preparationAtPublish).toStrictEqual(prepared);
	});

	it("should withhold activation while a prior place still owes publishing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));
		harness.setState({
			...harness.getState()!,
			pendingRebuild: new Set([asResourceKey("former"), asResourceKey("start")]),
		});
		const result = await publish(harness.options);
		assert(!result.success && result.err.kind === "applyFailed");

		expect(result.err.cause.visibility).toStrictEqual([
			{ status: "deferred", target: "public", universeId: "1234567890" },
		]);
		expect(result.err.cause.failures[0].kind).toBe("driverFailure");

		assert(result.err.cause.failures[0].kind === "driverFailure");

		expect(result.err.cause.failures[0].cause.message).toBe(
			"Public visibility requires successful provision with the current configuration and all owed places published",
		);
		expect(harness.getState()!.pendingRebuild).toStrictEqual(
			new Set([asResourceKey("former")]),
		);
		expect(harness.events).not.toContain("public");
	});

	it("should reject preparation recorded for a private target even when its fingerprint matches", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const harness = fixture("public", true);
		assertSuccess(await provision(harness.options));
		const prepared = harness.getState()!;
		assert(prepared.universeVisibility !== undefined);
		harness.setState({
			...prepared,
			universeVisibility: { ...prepared.universeVisibility, target: "private" },
		});
		const result = await publish(harness.options);

		expect(result).toMatchObject({
			err: { cause: { visibility: [{ status: "deferred" }] } },
			success: false,
		});
		expect(harness.events).not.toContain("public");
	});
});
