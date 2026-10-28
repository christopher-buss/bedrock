import type { Result } from "@bedrock-rbx/ocale";
import { fromPartial } from "@total-typescript/shoehorn";

import { describe, it } from "vitest";

import { universeCurrent } from "#tests/helpers/resources";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { DeployError } from "./deploy.ts";
import { runVisibilityStageAsync } from "./run-visibility-stage.ts";

const production: BedrockState = {
	environment: "production",
	resources: [universeCurrent({ visibility: "private" })],
	version: 1,
};

const staging: BedrockState = {
	environment: "staging",
	resources: [],
	universeVisibility: { status: "intent", target: "private", universeId: "222" },
	version: 1,
};

const stopped: DeployError = {
	cause: { file: "state.json", kind: "stateError", reason: "stopped" },
	kind: "stateReadFailed",
};

function statePort(): StatePort {
	return {
		async read(environment) {
			return {
				data: {
					state: environment === "production" ? production : staging,
					version: { kind: "present", token: environment },
				},
				success: true,
			};
		},
		async write() {
			throw new Error("unused write");
		},
	};
}

function config(visibility?: "private"): ResolvedConfig {
	return {
		environments: { production: {}, staging: {} },
		universe: { universeId: "1234567890", ...(visibility ? { visibility } : {}) },
	};
}

describe(runVisibilityStageAsync, () => {
	it("should read another environment from its own record while visibility is managed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		let foreign: Result<StateRecord, StateError> | undefined;
		await runVisibilityStageAsync({
			config: config("private"),
			environment: "production",
			registry: fromPartial<DriverRegistry>({}),
			async run(_config, port) {
				foreign = await port.read("staging");
				return { err: stopped, success: false };
			},
			stage: "provision",
			statePort: statePort(),
		});

		expect(foreign).toStrictEqual({
			data: { state: staging, version: { kind: "present", token: "staging" } },
			success: true,
		});
	});

	it("should keep another environment's journal out of an unmanaged snapshot", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await runVisibilityStageAsync({
			config: config(),
			environment: "production",
			registry: fromPartial<DriverRegistry>({}),
			async run(_config, port) {
				await port.read("staging");
				return { data: production, success: true };
			},
			stage: "provision",
			statePort: statePort(),
		});

		expect(result).toStrictEqual({
			data: { ...production, resources: [universeCurrent()] },
			success: true,
		});
	});
});
