// Empirically measures what ONE `Cloud_GetLuauExecutionSessionTask` call
// costs against its `x-ratelimit-remaining` counter, for a single API key
// + IP.
//
// Why this probe exists: the deadline-overrun spike
// (`docs/spikes/luau-deadline-overrun`) captured the counter falling
// 127, 123, 119, 117, 112, 108 across consecutive single GETs polled once
// per second, i.e. about 4 units per read against a `200;w=60` window.
// Ocale paces this operation at 200/min (`GET_OPERATION_LIMIT` in
// `src/domains/cloud-v2/luau-execution-tasks/operations.ts`) and its
// header-primed budget gate reserves ONE unit per send. If a read really
// costs 4, both are wrong by 4x. But the spike's steps also scale with
// elapsed time rather than call count, which is what a second consumer on
// the same key or IP would look like. This probe separates the two:
//
//   burst  N sequential GETs on one task with NO artificial delay, so the
//          wall time is short and the counter drop is dominated by our own
//          calls. The median per-call drop is the per-read cost.
//   idle   one pause with no traffic, then one more GET. Any drop across
//          the pause is background drain from another consumer, in units/s.
//
// How it works: submit exactly ONE trivial task (`return 1`) at the place's
// head version (or reuse ROBLOX_TEST_TASK_PATH to spend no submit budget),
// then run the two phases above and print a summary. Analysis lives in
// `luau-task-read-cost.ts` and is unit-tested.
//
// Run with (Bun loads `.env` from the working directory):
//   ROBLOX_API_KEY=<key with universe.place.luau-execution-session:write,read> \
//   ROBLOX_TEST_UNIVERSE_ID=<universe id> \
//   ROBLOX_TEST_PLACE_ID=<place id> \
//   [ROBLOX_TEST_TASK_PATH=universes/../tasks/..] \
//   [PROBE_READS=20] [PROBE_IDLE_MS=10000] \
//   bun packages/open-cloud/scripts/probe-luau-task-read-cost.ts
//
// The script never writes to the repo. It needs real Open Cloud
// credentials, so it cannot be run in CI.

import process from "node:process";

import { buildGetUrl, parseTaskRef, summarizeReadCost } from "./luau-task-read-cost.ts";
import type { ReadSample } from "./luau-task-read-cost.ts";

const API_BASE = "https://apis.roblox.com";
const DEFAULT_READS = 20;
const DEFAULT_IDLE_MS = 10_000;
const MAX_READS = 150;
const MS_PER_SECOND = 1000;

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface ReadTarget {
	readonly apiKey: string;
	readonly url: string;
}

function firstToken(value: string | undefined): number | undefined {
	const token = value?.split(",", 1)[0]?.trim();
	if (token === undefined || token === "") {
		return undefined;
	}

	const parsed = Number.parseInt(token, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function reduceTokens(
	value: string | undefined,
	combine: (a: number, b: number) => number,
): number | undefined {
	const tokens = (value ?? "")
		.split(",")
		.map((part) => Number.parseInt(part.trim(), 10))
		.filter((part) => !Number.isNaN(part));
	return tokens.length === 0 ? undefined : tokens.reduce(combine);
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined) {
		return fallback;
	}

	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function submitTask({ apiKey, placeId, universeId }: Credentials): Promise<string> {
	const path = `/cloud/v2/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`;
	const body = JSON.stringify({ script: "return 1" });
	console.log(`\n>>> POST ${path}`);
	const response = await fetch(`${API_BASE}${path}`, {
		body,
		headers: { "content-type": "application/json", "x-api-key": apiKey },
		method: "POST",
	});
	const text = await response.text();
	console.log(`<<< status: ${response.status.toString()}`);
	console.log(`<<< body: ${text.length === 0 ? "(empty)" : text}`);
	return text;
}

async function readTask({ apiKey, url }: ReadTarget, index: number): Promise<ReadSample> {
	const response = await fetch(`${API_BASE}${url}`, { headers: { "x-api-key": apiKey } });
	const timeMs = performance.now();
	// Drain the body so the connection is freed for the next iteration.
	await response.text();

	const limitHeader = response.headers.get("x-ratelimit-limit") ?? undefined;
	const remainingHeader = response.headers.get("x-ratelimit-remaining") ?? undefined;
	const resetHeader = response.headers.get("x-ratelimit-reset") ?? undefined;
	const sample: ReadSample = {
		limit: firstToken(limitHeader),
		remaining: reduceTokens(remainingHeader, Math.min),
		status: response.status,
		timeMs,
	};
	console.log(
		`GET #${(index + 1).toString()} status=${sample.status.toString()} ` +
			`limit=${limitHeader ?? "(none)"} remaining=${remainingHeader ?? "(none)"} ` +
			`reset=${resetHeader ?? "(none)"}`,
	);
	return sample;
}

async function resolveGetUrl(credentials: Credentials): Promise<string> {
	const reusedPath = process.env["ROBLOX_TEST_TASK_PATH"];
	const bodyText =
		reusedPath === undefined
			? await submitTask(credentials)
			: JSON.stringify({ path: reusedPath });
	const url = buildGetUrl(parseTaskRef(bodyText));
	if (url === undefined) {
		console.error("!!! could not derive a version-pinned session task GET url; aborting");
		process.exit(1);
	}

	return url;
}

async function probe(credentials: Credentials): Promise<void> {
	const url = await resolveGetUrl(credentials);
	const reads = Math.min(MAX_READS, positiveIntegerEnvironment("PROBE_READS", DEFAULT_READS));
	const idleMs = positiveIntegerEnvironment("PROBE_IDLE_MS", DEFAULT_IDLE_MS);
	console.log(`\n=== target GET url: ${url} ===`);
	console.log(`=== burst: ${reads.toString()} sequential GETs, no artificial delay ===`);

	const target: ReadTarget = { apiKey: credentials.apiKey, url };
	const burst: Array<ReadSample> = [];
	for (let index = 0; index < reads; index += 1) {
		burst.push(await readTask(target, index));
	}

	console.log(`\n=== idle: sleeping ${(idleMs / MS_PER_SECOND).toString()}s with no traffic ===`);
	await sleep(idleMs);
	const after = await readTask(target, reads);

	const summary = summarizeReadCost({ burst, idle: { after, before: burst.at(-1) } });
	console.log("\n========== SUMMARY ==========");
	console.log(`burst deltas: ${summary.burstDeltas.join(", ")}`);
	console.log(`units per read (median): ${summary.unitsPerRead?.toString() ?? "(n/a)"}`);
	console.log(`burst drop per second: ${summary.burstDropPerSecond?.toString() ?? "(n/a)"}`);
	console.log(`idle drain per second: ${summary.idleDrainPerSecond?.toString() ?? "(n/a)"}`);
	console.log(
		`effective reads per window: ${summary.effectiveReadsPerWindow?.toString() ?? "(n/a)"}`,
	);
	console.log(`verdict: ${summary.verdict}`);
	console.log(
		"caveat: this measures this API key AND this machine's IP combined; any other " +
			"process using either during the run shows up as drain, not as read cost.",
	);
	console.log("=============================");
}

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined || PLACE_ID === undefined) {
	console.error("ROBLOX_API_KEY, ROBLOX_TEST_UNIVERSE_ID, and ROBLOX_TEST_PLACE_ID must be set");
	process.exit(1);
}

await probe({ apiKey: API_KEY, placeId: PLACE_ID, universeId: UNIVERSE_ID });
