import { assert, describe, expect, it } from "vitest";

import { LIST_LOGS_SPEC } from "#src/domains/cloud-v2/luau-execution-task-logs/specs";
import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "#src/domains/cloud-v2/luau-execution-tasks/specs";
import { getOpenApiDocument, isRecord } from "./_helpers.ts";

const SECONDS_PER_MINUTE = 60;

const PINS = [
	["Cloud_CreateLuauExecutionSessionTask__Using_Universes", SUBMIT_HEAD_SPEC.operationLimit],
	[
		"Cloud_CreateLuauExecutionSessionTask__Using_Universes_Places",
		SUBMIT_VERSION_SPEC.operationLimit,
	],
	["Cloud_GetLuauExecutionSessionTask", GET_SPEC.operationLimit],
	["Cloud_ListLuauExecutionSessionTaskLogs", LIST_LOGS_SPEC.operationLimit],
] as const;

/**
 * Locates one operation in the vendored OpenAPI document by its
 * `operationId`, flattening every path item's methods.
 *
 * @param operationId - The `operationId` to look up under `paths`.
 * @returns The operation object.
 */
function findOperation(operationId: string): Readonly<Record<string, unknown>> {
	const { paths } = getOpenApiDocument();
	assert(isRecord(paths), "OpenAPI document missing paths");

	const operation = Object.values(paths)
		.filter(isRecord)
		.flatMap((pathItem) => Object.values(pathItem))
		.filter(isRecord)
		.find((candidate) => candidate["operationId"] === operationId);

	assert(operation, `operation ${operationId} not found in vendor OpenAPI doc`);
	return operation;
}

/**
 * Reads the per-API-key-owner allowance the vendored OpenAPI document
 * declares for one operation, in requests per minute.
 *
 * @param operationId - The `operationId` to look up under `paths`.
 * @returns The `x-roblox-rate-limits.perApiKeyOwner.maxInPeriod` value.
 */
function perMinuteAllowance(operationId: string): number {
	const limits = findOperation(operationId)["x-roblox-rate-limits"];
	assert(isRecord(limits), `${operationId} declares no x-roblox-rate-limits`);
	const { perApiKeyOwner } = limits;
	assert(isRecord(perApiKeyOwner), `${operationId} declares no perApiKeyOwner limit`);
	assert(
		perApiKeyOwner["period"] === "MINUTE",
		`${operationId} meters over a period this pin cannot convert`,
	);

	const { maxInPeriod } = perApiKeyOwner;
	assert(typeof maxInPeriod === "number");
	return maxInPeriod;
}

describe("luau-execution specs are paced by their own operation's declared rate", () => {
	it.for(PINS)("should pace %s at the rate that operation declares", ([operationId, limit]) => {
		expect.assertions(1);

		expect(limit.maxPerSecond).toBe(perMinuteAllowance(operationId) / SECONDS_PER_MINUTE);
	});
});
