import { assert, describe, it, vi } from "vitest";

import type { Credential } from "#src/client/types";
import * as binaryInputOperations from "#src/domains/cloud-v2/luau-execution-task-binary-inputs/operations";
import * as logOperations from "#src/domains/cloud-v2/luau-execution-task-logs/operations";
import * as taskOperations from "#src/domains/cloud-v2/luau-execution-tasks/operations";
import * as queueOperations from "#src/domains/cloud-v2/memory-store-queues/operations";
import * as sortedMapOperations from "#src/domains/cloud-v2/memory-store-sorted-maps/operations";
import { PUBLISH_OPERATION_LIMIT } from "#src/domains/universes/places/operations";
import { CredentialNotSupportedError } from "#src/errors/credential-not-supported";
import { LuauExecutionClient } from "#src/resources/luau-execution/client";
import { PlacesClient } from "#src/resources/places/client";
import { StorageClient } from "#src/resources/storage/client";
import type { Result } from "#src/types";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { rbxlBody } from "#tests/helpers/places";

type TokenProvider = Extract<Credential, { kind: "oauth" }>["getAccessToken"];

interface Clients {
	readonly luau: LuauExecutionClient;
	readonly places: PlacesClient;
	readonly storage: StorageClient;
}

type Call = (clients: Clients) => Promise<Result<unknown, unknown>>;

const TASK_REF = {
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
};

const SUBMIT = { placeId: "456", script: "return 1", universeId: "123" };
const PUBLISH = { body: rbxlBody(), format: "rbxl", placeId: "456", universeId: "123" } as const;

const PINS: ReadonlyArray<readonly [string, string, Call]> = [
	["places.publishVersion", "publish", async ({ places }) => places.publish(PUBLISH)],
	["places.publishVersion", "save", async ({ places }) => places.save(PUBLISH)],
	["luau-execution-tasks.submit", "submit", async ({ luau }) => luau.tasks.submit(SUBMIT)],
	[
		"luau-execution-tasks.submit-at-version",
		"submit at version",
		async ({ luau }) => luau.tasks.submit({ ...SUBMIT, versionId: "789" }),
	],
	["luau-execution-tasks.get", "get", async ({ luau }) => luau.tasks.get({ ref: TASK_REF })],
	[
		"luau-execution-task-logs.list",
		"list logs",
		async ({ luau }) => luau.tasks.listLogs({ ref: TASK_REF }),
	],
	[
		"luau-execution-task-binary-inputs.create",
		"create binary input",
		async ({ luau }) => luau.binaryInputs.create({ size: 1024, universeId: "123" }),
	],
	[
		"luau-execution-tasks.submit",
		"places submit",
		async ({ places }) => places.luauExecution.submit(SUBMIT),
	],
	[
		"luau-execution-tasks.submit-at-version",
		"places submit at version",
		async ({ places }) => places.luauExecution.submit({ ...SUBMIT, versionId: "789" }),
	],
	[
		"luau-execution-tasks.get",
		"places get",
		async ({ places }) => places.luauExecution.get({ ref: TASK_REF }),
	],
	[
		"luau-execution-task-logs.list",
		"places list logs",
		async ({ places }) => places.luauExecution.listLogs({ ref: TASK_REF }),
	],
	[
		"memory-store-queues.enqueue",
		"enqueue",
		async ({ storage }) => {
			return storage.queues.enqueue({ data: "x", queueId: "q", universeId: "123" });
		},
	],
	[
		"memory-store-queues.dequeue",
		"dequeue",
		async ({ storage }) => {
			return storage.queues.dequeue({ count: 1, queueId: "q", universeId: "123" });
		},
	],
	[
		"memory-store-queues.discard",
		"discard",
		async ({ storage }) => {
			return storage.queues.discard({ queueId: "q", readId: "r", universeId: "123" });
		},
	],
	[
		"memory-store-sorted-maps.create",
		"sorted map create",
		async ({ storage }) => {
			return storage.sortedMaps.create({
				itemId: "a",
				mapId: "m",
				universeId: "123",
				value: "v",
			});
		},
	],
	[
		"memory-store-sorted-maps.delete",
		"sorted map delete",
		async ({ storage }) => {
			return storage.sortedMaps.delete({ itemId: "a", mapId: "m", universeId: "123" });
		},
	],
	[
		"memory-store-sorted-maps.get",
		"sorted map get",
		async ({ storage }) => {
			return storage.sortedMaps.get({ itemId: "a", mapId: "m", universeId: "123" });
		},
	],
	[
		"memory-store-sorted-maps.list",
		"sorted map list",
		async ({ storage }) => storage.sortedMaps.list({ mapId: "m", universeId: "123" }),
	],
	[
		"memory-store-sorted-maps.update",
		"sorted map update",
		async ({ storage }) => {
			return storage.sortedMaps.update({
				itemId: "a",
				mapId: "m",
				universeId: "123",
				value: "v",
			});
		},
	],
];

function operationKeysOf(module: Record<string, unknown>): Array<string> {
	return Object.values(module).flatMap((value) => {
		return typeof value === "object" && value !== null && "operationKey" in value
			? [String(value.operationKey)]
			: [];
	});
}

// PINS lists every Operation Roblox accepts only with an API key, with one
// public call that reaches it. Luau execution is reached both from its own
// client and from `PlacesClient.luauExecution`.
describe("api-key-only operations", () => {
	it("should pin every operation of the API-key-only domains", ({ expect }) => {
		expect.assertions(1);

		const domainKeys = [
			PUBLISH_OPERATION_LIMIT.operationKey,
			...operationKeysOf(taskOperations),
			...operationKeysOf(logOperations),
			...operationKeysOf(binaryInputOperations),
			...operationKeysOf(queueOperations),
			...operationKeysOf(sortedMapOperations),
		];

		expect(new Set(PINS.map(([operationKey]) => operationKey))).toStrictEqual(
			new Set(domainKeys),
		);
	});

	it.for(PINS)(
		"should reject an OAuth call to %s (%s) without a token or a request",
		async ([operationKey, , call], { expect }) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" });
			const getAccessToken = vi.fn<TokenProvider>(() => "token");
			const options = {
				credential: { getAccessToken, identity: "user-1", kind: "oauth" },
				httpClient,
				sleep: createFakeSleep(),
			} as const;

			const result = await call({
				luau: new LuauExecutionClient(options),
				places: new PlacesClient(options),
				storage: new StorageClient(options),
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(CredentialNotSupportedError);
			expect(result.err).toMatchObject({ operationKey });
			expect(getAccessToken).not.toHaveBeenCalled();
			expect(httpClient.requests).toHaveLength(0);
		},
	);
});
