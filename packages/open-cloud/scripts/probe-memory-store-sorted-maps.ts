// Captures the live Open Cloud wire shape for memory-store sorted-map
// items. The script is invoked manually, hits `apis.roblox.com`
// directly (bypassing the SDK so the bytes on the wire are
// caller-controlled), and prints each request/response so the operator
// has direct evidence of what the server accepts and emits.
//
// Use it to:
//   - regenerate the recorded fixtures under
//     `tests/fixtures/memory-store-sorted-maps/`
//   - investigate a suspected drift between the vendored schema and
//     the live API (the basis for entries in
//     `vendor/README.md` -> "Local drift patches")
//
// Run with:
// BEDROCK_API_KEY=<key with universe.memory-store-sorted-map-item:write,delete>
// \ ROBLOX_TEST_UNIVERSE_ID=<universe id> \ bun
// packages/open-cloud/scripts/probe-memory-store-sorted-maps.ts
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
	readonly isoItemId: string;
	readonly isoItemPath: string;
	readonly protobufItemId: string;
	readonly protobufItemPath: string;
}

async function call(apiKey: string, request: ProbeRequest): Promise<void> {
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
}

async function deleteSilently(apiKey: string, path: string): Promise<void> {
	try {
		await call(apiKey, { method: "DELETE", path });
	} catch (err) {
		console.error(`!!! cleanup delete failed (${path}): ${String(err)}`);
	}
}

function makeContext(universeId: string): ProbeContext {
	const suffix = Date.now().toString(36);
	const mapId = `bedrock-probe-${suffix}`;
	const basePath = `/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${mapId}/items`;
	const protobufItemId = `ttl-protobuf-${suffix}`;
	const isoItemId = `ttl-iso-${suffix}`;
	return {
		basePath,
		isoItemId,
		isoItemPath: `${basePath}/${isoItemId}`,
		protobufItemId,
		protobufItemPath: `${basePath}/${protobufItemId}`,
	};
}

async function runProbes(apiKey: string, context: ProbeContext): Promise<void> {
	console.log("=== probe A: create with protobuf-duration ttl `5s` ===");
	await call(apiKey, {
		body: { ttl: "5s", value: { probe: "ttl-protobuf" } },
		method: "POST",
		path: `${context.basePath}?id=${context.protobufItemId}`,
	});

	console.log(
		"\n=== probe B: create with ISO-8601 ttl `PT5S` (expect rejection if patch #7 is correct) ===",
	);
	await call(apiKey, {
		body: { ttl: "PT5S", value: { probe: "ttl-iso" } },
		method: "POST",
		path: `${context.basePath}?id=${context.isoItemId}`,
	});

	console.log("\n=== probe C: get protobuf-ttl item (capture response shape) ===");
	await call(apiKey, { method: "GET", path: context.protobufItemPath });

	console.log("\n=== probe D: list items (capture array-key name) ===");
	await call(apiKey, { method: "GET", path: `${context.basePath}?maxPageSize=100` });
}

async function probe(apiKey: string, universeId: string): Promise<void> {
	const context = makeContext(universeId);
	try {
		await runProbes(apiKey, context);
	} finally {
		console.log("\n=== cleanup ===");
		await deleteSilently(apiKey, context.protobufItemPath);
		await deleteSilently(apiKey, context.isoItemPath);
	}
}

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined) {
	console.error("BEDROCK_API_KEY and ROBLOX_TEST_UNIVERSE_ID must be set");
	process.exit(1);
}

await probe(API_KEY, UNIVERSE_ID);
