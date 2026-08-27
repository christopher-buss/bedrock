import { NetworkError, OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import { describe, expect, it } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { createClackProgressAdapter } from "./clack-progress-adapter.ts";

describe(createClackProgressAdapter, () => {
	it("should render a deploySuccess event as the existing per-env summary line", () => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 3 resources reconciled",
		);
		expect(clack.logError).not.toHaveBeenCalled();
	});

	it("should delegate a deployFailure event to renderDeployError", () => {
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

	it("should stay silent on resourceOpStarted (no spinner, no line)", () => {
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

	it("should render resourceOpSucceeded (create form) with the per-kind Roblox ID", () => {
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

	it("should render resourceOpSucceeded (create form) without an ID for places", () => {
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

	it("should render resourceOpSucceeded (update form) listing the changed fields", () => {
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

	it("should render resourceOpNoop as an unchanged line", () => {
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

	it("should render resourceOpFailed with the driverFailure cause message", () => {
		expect.assertions(1);

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
	});

	it("should expand a network driverFailure with its transport code and failing call", () => {
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

	it("should render resourceOpFailed for the unexpectedThrow ApplyError", () => {
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

	it("should render resourceOpFailed for a permission driverFailure with the scope guidance", () => {
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

	it("should render resourceOpFailed for the updateUnsupported ApplyError", () => {
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

	it("should render applySummary as the aggregate footer with one-decimal seconds", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			created: 1,
			durationMs: 4123,
			environment: "production",
			failed: 1,
			kind: "applySummary",
			noop: 1,
			updated: 1,
		});

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Succeeded in 4.1s: 1 create, 1 update, 1 noop, 1 failed",
		);
	});

	it("should render locking being off as a warning naming the environment", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "stateLockDisabled" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Locking is off for production by config: concurrent deploys are not held apart",
		);
	});

	it("should render a contended lock wait naming the holder and the time left", () => {
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

	it("should render a contended lock wait without a holder when the record was unreadable", () => {
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

	it("should render a lease the backend could not keep as an error", () => {
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

	it("should render stateWritten with the gist backend label resolved from the config", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} }, state: { backend: "gist", gistId: "abc" } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to gist:abc");
	});

	it("should render stateWritten with the generic 'state' label when no config is provided", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to state");
	});

	it("should render stateWritten with the generic 'state' label when state config is absent for the environment", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to state");
	});

	it("should render stateWritten with the raw backend tag for non-gist backends", () => {
		expect.assertions(1);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({
			clack,
			config: { environments: { production: {} }, state: { backend: "custom" } },
		});

		port.emit({ environment: "production", kind: "stateWritten" });

		expect(clack.logMessage).toHaveBeenCalledExactlyOnceWith("State written to custom");
	});
});
