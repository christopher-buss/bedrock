// Captures the live Open Cloud wire shape for memory-store queue items
// and the read/discard custom-method responses. Sister of
// `probe-memory-store-sorted-maps.ts`; same conventions apply. Each
// probe targets a specific entry in `vendor/README.md` -> "Local
// drift patches":
//
//   - Probes A (create + ttl="5s") and B (create + ttl="PT5S") prove
//     patch #4 (`MemoryStoreQueueItem.ttl` drops invalid
//     `format: "duration"`).
//   - Probe C (create with no `data`) proves patch #1
//     (`MemoryStoreQueueItem.required` gains `"data"`).
//   - Probe D (create with caller-supplied `path`) probes patch #2
//     (`MemoryStoreQueueItem.path` becomes `readOnly`).
//   - Probes E (read + invisibilityWindow="3s") and F (read +
//     invisibilityWindow="PT3S") prove patch #5
//     (`Cloud_ReadMemoryStoreQueueItems.invisibilityWindow` drops
//     invalid `format: "duration"`). Probe E's response body also
//     proves patch #3 (`ReadMemoryStoreQueueItemsResponse` renames
//     `items→queueItems`, `readId→id`).
//
// Run with:
// BEDROCK_API_KEY=<key with universe.memory-store-queue-item:write,read,delete>
// \ ROBLOX_TEST_UNIVERSE_ID=<universe id> \ bun
// packages/open-cloud/scripts/probe-memory-store-queues.ts
//
// The script never writes to the repo. Pipe stdout to a file if you
// want to keep the capture (`... | tee probe.log`).

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

interface ProbeRequest {
	readonly body?: Record<string, unknown>;
	readonly method: "DELETE" | "GET" | "PATCH" | "POST";
	readonly path: string;
}

interface ProbeContext {
	readonly basePath: string;
	readonly discardPath: string;
	readonly readPath: string;
}

interface DiscardArgs {
	readonly apiKey: string;
	readonly discardPath: string;
	readonly readId: string;
}

interface CreateProbe {
	readonly body: Record<string, unknown>;
	readonly heading: string;
}

async function call(apiKey: string, request: ProbeRequest): Promise<string> {
	const headers: Record<string, string> = { "x-api-key": apiKey };
	const init: RequestInit = { headers, method: request.method };
	if (request.body !== undefined) {
		headers["content-type"] = "application/json";
		init.body = JSON.stringify(request.body);
	}

	console.log(`\n>>> ${request.method} ${request.path}`);
	if (typeof init.body === "string") {
		console.log(`>>> body: ${init.body}`);
	}

	const response = await fetch(`${API_BASE}${request.path}`, init);
	const bodyText = await response.text();
	console.log(`<<< status: ${response.status.toString()}`);
	console.log(`<<< body: ${bodyText.length === 0 ? "(empty)" : bodyText}`);
	return bodyText;
}

async function discardSilently(args: DiscardArgs): Promise<void> {
	try {
		await call(args.apiKey, {
			body: { readId: args.readId },
			method: "POST",
			path: args.discardPath,
		});
	} catch (err) {
		console.error(`!!! cleanup discard failed: ${String(err)}`);
	}
}

function makeContext(universeId: string): ProbeContext {
	const suffix = Date.now().toString(36);
	const queueId = `bedrock-probe-${suffix}`;
	const basePath = `/cloud/v2/universes/${universeId}/memory-store/queues/${queueId}/items`;
	return {
		basePath,
		discardPath: `${basePath}:discard`,
		readPath: `${basePath}:read`,
	};
}

function extractReadId(bodyText: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(bodyText);
		if (parsed === null || typeof parsed !== "object") {
			return undefined;
		}

		const id: unknown = Reflect.get(parsed, "id");
		return typeof id === "string" ? id : undefined;
	} catch {
		return undefined;
	}
}

const CREATE_PROBES: ReadonlyArray<CreateProbe> = [
	{
		body: { data: { probe: "queue-protobuf" }, ttl: "5s" },
		heading: "probe A: create with protobuf-duration ttl `5s` and valid data (patch #4)",
	},
	{
		body: { data: { probe: "queue-iso" }, ttl: "PT5S" },
		heading:
			"probe B: create with ISO-8601 ttl `PT5S` (expect rejection if patch #4 is correct)",
	},
	{
		body: { ttl: "5s" },
		heading: "probe C: create with missing `data` (expect rejection if patch #1 is correct)",
	},
	{
		body: {
			data: { probe: "queue-path" },
			path: "cloud/v2/universes/0/memory-store/queues/evil/items/forged",
		},
		heading:
			"probe D: create with caller-supplied `path` (probe patch #2 — readOnly or silent-strip?)",
	},
];

async function runCreateProbes(apiKey: string, context: ProbeContext): Promise<void> {
	for (const [index, entry] of CREATE_PROBES.entries()) {
		console.log(`${index === 0 ? "" : "\n"}=== ${entry.heading} ===`);
		await call(apiKey, { body: entry.body, method: "POST", path: context.basePath });
	}
}

async function runReadProbes(apiKey: string, context: ProbeContext): Promise<string | undefined> {
	console.log(
		"\n=== probe E: read with protobuf invisibilityWindow `3s` (capture response keys for patches #3, #5) ===",
	);
	const readBody = await call(apiKey, {
		method: "GET",
		path: `${context.readPath}?count=10&invisibilityWindow=3s`,
	});

	console.log(
		"\n=== probe F: read with ISO-8601 invisibilityWindow `PT3S` (expect rejection if patch #5 is correct) ===",
	);
	await call(apiKey, {
		method: "GET",
		path: `${context.readPath}?count=10&invisibilityWindow=PT3S`,
	});

	return extractReadId(readBody);
}

async function probe(apiKey: string, universeId: string): Promise<void> {
	const context = makeContext(universeId);
	let readId: string | undefined;
	try {
		await runCreateProbes(apiKey, context);
		readId = await runReadProbes(apiKey, context);
	} finally {
		console.log("\n=== cleanup ===");
		if (readId === undefined) {
			console.log("(no readId captured; remaining items will expire via TTL)");
		} else {
			await discardSilently({ apiKey, discardPath: context.discardPath, readId });
		}
	}
}

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined) {
	console.error("BEDROCK_API_KEY and ROBLOX_TEST_UNIVERSE_ID must be set");
	process.exit(1);
}

await probe(API_KEY, UNIVERSE_ID);
