import { NetworkError, OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import { describe, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { withoutStack } from "#tests/helpers/errors";
import { withVerbosity } from "../cli/render.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { createClackProgressAdapter } from "./clack-progress-adapter.ts";

describe(createClackProgressAdapter, () => {
	it("should warn that a failed release may need lock recovery", ({ expect }) => {
		expect.assertions(3);

		const clack = fakeClackPort();
		createClackProgressAdapter({ clack }).emit({
			environment: "production",
			error: { reason: "lock store unreachable" },
			kind: "stateLockReleaseFailed",
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Warning: could not release the production state lock: lock store unreachable. A later run may wait for expiry or need explicit recovery with bedrock state unlock --env production.",
		);
		expect(clack.logError).not.toHaveBeenCalled();
		expect(clack.cancel).not.toHaveBeenCalled();
	});

	it("should identify a created product by its marketplace ID", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		createClackProgressAdapter({ clack }).emit({
			key: asResourceKey("coins"),
			environment: "production",
			kind: "resourceOpSucceeded",
			opType: "create",
			outputs: { iconImageAssetId: undefined, productId: asRobloxAssetId("100") },
			resourceKind: "developerProduct",
		});

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"developerProduct.coins created (id 100)",
		);
	});

	it("should identify an adopted universe by its root place ID", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		createClackProgressAdapter({ clack }).emit({
			key: asResourceKey("main"),
			environment: "production",
			kind: "resourceOpSucceeded",
			opType: "create",
			outputs: { rootPlaceId: asRobloxAssetId("200") },
			resourceKind: "universe",
		});

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith("universe.main created (id 200)");
	});

	it("should render a deploySuccess event as the existing per-env summary line", ({ expect }) => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 3 resources reconciled",
		);
		expect(clack.logError).not.toHaveBeenCalled();
	});

	it("should delegate a deployFailure event to renderDeployError", ({ expect }) => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			environment: "ghost",
			error: { declared: ["production"], environment: "ghost", kind: "unknownEnvironment" },
			kind: "deployFailure",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"unknown environment 'ghost' (declared: production)",
		);
		expect(clack.logSuccess).not.toHaveBeenCalled();
	});

	it("should stay silent on resourceOpStarted (no spinner, no line)", ({ expect }) => {
		expect.assertions(4);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			key: asResourceKey("vip-pass"),
			environment: "production",
			kind: "resourceOpStarted",
			opType: "create",
			resourceKind: "gamePass",
		});

		expect(clack.logSuccess).not.toHaveBeenCalled();
		expect(clack.logMessage).not.toHaveBeenCalled();
		expect(clack.logError).not.toHaveBeenCalled();
		expect(clack.cancel).not.toHaveBeenCalled();
	});

	it("should render resourceOpSucceeded (create form) with the per-kind Roblox ID", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			key: asResourceKey("vip-pass"),
			environment: "production",
			kind: "resourceOpSucceeded",
			opType: "create",
			outputs: {
				assetId: asRobloxAssetId("987654321"),
				iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
			},
			resourceKind: "gamePass",
		});

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"gamePass.vip-pass created (id 987654321)",
		);
	});

	it("should render resourceOpSucceeded (create form) without an ID for places", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			key: asResourceKey("start-place"),
			environment: "production",
			kind: "resourceOpSucceeded",
			opType: "create",
			outputs: { versionNumber: 7 },
			resourceKind: "place",
		});

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith("place.start-place created");
	});

	it("should render resourceOpSucceeded (update form) listing the changed fields", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			key: asResourceKey("vip-pass"),
			changedFields: ["name", "price"],
			environment: "production",
			kind: "resourceOpSucceeded",
			opType: "update",
			resourceKind: "gamePass",
		});

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"gamePass.vip-pass name, price updated",
		);
	});

	it("should render resourceOpNoop as an unchanged line", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			key: asResourceKey("sync-pass"),
			environment: "production",
			kind: "resourceOpNoop",
			resourceKind: "gamePass",
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("gamePass.sync-pass unchanged");
	});

	it("should render resourceOpFailed with the driverFailure cause message", ({ expect }) => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });
		const key = asResourceKey("vip-pass");

		port.emit({
			key,
			environment: "production",
			error: { key, cause: new OpenCloudError("boom"), kind: "driverFailure" },
			kind: "resourceOpFailed",
			opType: "create",
			resourceKind: "gamePass",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith("gamePass.vip-pass failed: boom");
		expect(clack.logMessage).not.toHaveBeenCalled();
	});

	it.for<{ logged: ReadonlyArray<string>; verbose: boolean }>([
		{ logged: ["OpenCloudError: boom"], verbose: true },
		{ logged: [], verbose: false },
	])(
		"should follow a failed resource line with diagnostics only when verbose is $verbose",
		({ logged, verbose }, { expect }) => {
			expect.assertions(1);

			const clack = fakeClackPort();
			const port = createClackProgressAdapter({ clack: withVerbosity(clack, verbose) });
			const key = asResourceKey("vip-pass");
			const cause = withoutStack(new OpenCloudError("boom"));

			port.emit({
				key,
				environment: "production",
				error: { key, cause, kind: "driverFailure" },
				kind: "resourceOpFailed",
				opType: "create",
				resourceKind: "gamePass",
			});

			expect(vi.mocked(clack.logMessage).mock.calls.flat()).toStrictEqual(
				logged.map((line) => `caused by: ${line}`),
			);
		},
	);

	it("should print a failed resource's diagnostics once when the deploy then fails on it", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack: withVerbosity(clack, true) });
		const key = asResourceKey("vip-pass");
		const failure = {
			key,
			cause: withoutStack(new OpenCloudError("boom")),
			kind: "driverFailure",
		} as const;

		port.emit({
			key,
			environment: "production",
			error: failure,
			kind: "resourceOpFailed",
			opType: "create",
			resourceKind: "gamePass",
		});
		port.emit({
			environment: "production",
			error: { cause: { applied: [], failures: [failure] }, kind: "applyFailed" },
			kind: "deployFailure",
		});

		expect(vi.mocked(clack.logMessage).mock.calls).toStrictEqual([
			["caused by: OpenCloudError: boom"],
		]);
	});

	it("should follow a deploy failure with its cause chain when verbose", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack: withVerbosity(clack, true) });
		const cause = {
			cause: withoutStack(new Error("EACCES")),
			file: "gist:abc",
			kind: "stateError",
			reason: "unreadable",
		} as const;

		port.emit({
			environment: "production",
			error: { cause, kind: "stateReadFailed" },
			kind: "deployFailure",
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("caused by: Error: EACCES");
	});

	it("should expand a network driverFailure with its transport code and failing call", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });
		const key = asResourceKey("start");

		port.emit({
			key,
			environment: "development",
			error: {
				key,
				cause: new NetworkError("Network request failed", {
					cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
					method: "POST",
					url: "https://apis.roblox.com/universes/v1/9110019856/places/84607999013117/versions",
				}),
				kind: "driverFailure",
			},
			kind: "resourceOpFailed",
			opType: "update",
			resourceKind: "place",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"place.start failed: Network request failed (ECONNRESET) on POST https://apis.roblox.com/universes/v1/9110019856/places/84607999013117/versions",
		);
	});

	it("should render resourceOpFailed for the unexpectedThrow ApplyError", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });
		const key = asResourceKey("vip-pass");

		port.emit({
			key,
			environment: "production",
			error: { key, cause: new Error("boom"), kind: "unexpectedThrow" },
			kind: "resourceOpFailed",
			opType: "create",
			resourceKind: "gamePass",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"gamePass.vip-pass failed: unexpected error: boom",
		);
	});

	it("should render resourceOpFailed for a permission driverFailure with the scope guidance", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });
		const key = asResourceKey("gem-pack");

		port.emit({
			key,
			environment: "production",
			error: {
				key,
				cause: new PermissionError("HTTP 403", {
					operationKey: "developer-products.create",
					requiredScopes: ["developer-product:write"],
					statusCode: 403,
				}),
				kind: "driverFailure",
			},
			kind: "resourceOpFailed",
			opType: "create",
			resourceKind: "developerProduct",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"developerProduct.gem-pack failed: HTTP 403 on developer-products.create: missing required scope 'developer-product:write'. Grant it on the API key at https://create.roblox.com/credentials",
		);
	});

	it("should render resourceOpFailed for the updateUnsupported ApplyError", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });
		const key = asResourceKey("main");

		port.emit({
			key,
			environment: "production",
			error: { key, kind: "updateUnsupported" },
			kind: "resourceOpFailed",
			opType: "update",
			resourceKind: "universe",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"universe.main failed: update not supported",
		);
	});

	it("should render applySummary as the aggregate footer with one-decimal seconds", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			created: 1,
			durationMs: 4123,
			environment: "production",
			failed: 0,
			kind: "applySummary",
			noop: 1,
			retired: 0,
			untracked: 0,
			updated: 1,
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Succeeded in 4.1s: 1 create, 1 update, 1 noop, 0 failed",
		);
	});

	it("should render applySummary with failed ops as an error that does not claim success", ({
		expect,
	}) => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			created: 29,
			durationMs: 33_700,
			environment: "production",
			failed: 1,
			kind: "applySummary",
			noop: 4,
			retired: 0,
			untracked: 0,
			updated: 0,
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"Failed in 33.7s: 29 create, 0 update, 4 noop, 1 failed",
		);
		expect(clack.logMessage).not.toHaveBeenCalled();
	});

	it("should render locking being off as a warning naming the environment", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "stateLockDisabled" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Locking is off for production by config: concurrent deploys are not held apart",
		);
	});

	it("should render a contended lock wait naming the holder and the time left", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			elapsedMs: 1000,
			environment: "production",
			holder: "ci-run-7",
			kind: "stateLockWaiting",
			remainingMs: 299_000,
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Waiting for the production state lock, held by ci-run-7: 299.0s left",
		);
	});

	it("should render a contended lock wait without a holder when the record was unreadable", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			elapsedMs: 1000,
			environment: "production",
			kind: "stateLockWaiting",
			remainingMs: 299_000,
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Waiting for the production state lock: 299.0s left",
		);
	});

	it("should render a lease the backend could not keep as an error", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			environment: "production",
			error: { reason: "s3://my-bucket/locks/production.json is another run's now" },
			kind: "stateLockLeaseLost",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"Lost the production state lock: s3://my-bucket/locks/production.json is another run's now",
		);
	});

	it("should render stateWritten with the gist backend label resolved from the config", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} }, state: { backend: "gist", gistId: "abc" } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to gist:abc");
	});

	it("should render stateWritten with the generic 'state' label when no config is provided", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to state");
	});

	it("should render stateWritten with the generic 'state' label when state config is absent for the environment", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to state");
	});

	it("should render stateWritten with the raw backend tag for non-gist backends", ({
		expect,
	}) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} }, state: { backend: "custom" } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to custom");
	});

	it("should count state-only untrack operations in the summary", ({ expect }) => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const progress = createClackProgressAdapter({ clack });
		progress.emit({
			created: 0,
			durationMs: 1000,
			environment: "production",
			failed: 0,
			kind: "applySummary",
			noop: 0,
			retired: 0,
			untracked: 2,
			updated: 0,
		});

		expect(clack.logMessage).toHaveBeenCalledWith(
			"Succeeded in 1.0s: 0 create, 0 update, 2 untrack, 0 noop, 0 failed",
		);
	});
});
