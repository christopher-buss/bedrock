// Empirically determines the true rate limit and limiter SHAPE of the
// Open Cloud `Cloud_GetLuauExecutionSessionTask` operation (GET a luau
// execution task) for a single API key + IP.
//
// Why this probe exists: the human-readable Roblox docs and our vendored
// OpenAPI disagree on this operation's quota. The docs say "45 calls per
// minute per API key owner or IP address" (plus a separate "200 requests
// per minute across all API keys for a user or group"), while
// `vendor/roblox-openapi.json` encodes
// `x-roblox-rate-limits.perApiKeyOwner = 200`. Our SDK
// (`src/domains/cloud-v2/luau-execution-tasks/operations.ts`) trusts the
// vendored 200/min figure AND models the limiter as a token bucket. This
// probe answers two questions empirically:
//
//   (a) the real per-key/IP sustained ceiling (~45/min vs ~200/min), and
//   (b) whether recovery looks like a TOKEN BUCKET (steady drip refill)
//       or a FIXED 60s WINDOW (sharp reset at minute boundary).
//
// Result (2026-05-24, one key+IP): the schema's 200/min is correct, not the
// docs' 45/min; live headers read `x-ratelimit-limit: 200;w=60`, and the
// limiter is a FIXED 60s window (`x-ratelimit-reset` ticks to the boundary
// regardless of traffic; `retry-after` is a constant 5s that understates it).
//
// How it works: submit exactly ONE trivial task (`return 1`) at the
// place's head version, parse the resolved resource path from the create
// response, then hammer GET on that single task sequentially (no
// artificial delay) until throttled. On 429 it logs the throttle headers,
// sleeps the `retry-after`, and resumes, so it observes several
// throttle -> recovery cycles. At the end it prints a summary whose
// limiter-shape verdict reads the `x-ratelimit-limit`/`x-ratelimit-reset`
// headers directly (never the misleading `retry-after`).
//
// Run with:
// BEDROCK_API_KEY=<key with universe.place.luau-execution-session:write,read>
// \ ROBLOX_TEST_UNIVERSE_ID=<universe id> \ ROBLOX_TEST_PLACE_ID=<place
// id> \ bun packages/open-cloud/scripts/probe-luau-execution-rate-limit.ts
//
// The script never writes to the repo. Pipe stdout to a file if you want
// to keep the capture (`... | tee probe.log`). It needs real Open Cloud
// credentials, so it cannot be run in CI.

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

/** Hard caps so the loop can never run away even under odd server behaviour. */
const MAX_ELAPSED_MS = 150_000;
const MAX_TOTAL_GETS = 600;
const MAX_THROTTLE_CYCLES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 2;
const ROLLING_WINDOW_MS = 60_000;
const MS_PER_SECOND = 1000;

/** Matches any of the four x-aep-resource path shapes the create call may return. */
const PATH_PATTERN =
	/^universes\/(\d+)\/places\/(\d+)(?:\/versions\/(\d+))?(?:\/luau-execution-sessions\/([^/]+)\/tasks\/([^/]+)|\/luau-execution-session-tasks\/([^/]+))$/;

interface TaskRef {
	readonly placeId: string;
	readonly sessionId?: string | undefined;
	readonly taskId: string;
	readonly universeId: string;
	readonly versionId?: string | undefined;
}

interface GetSample {
	/** Captured rate-limit-relevant headers (lower-cased names). */
	readonly headers: Readonly<Record<string, string>>;
	/** `retry-after` header value when the response carried one. */
	readonly retryAfter?: string | undefined;
	/** HTTP status code. */
	readonly status: number;
	/** Monotonic `performance.now()` timestamp at response receipt. */
	readonly time: number;
}

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface FirstThrottle {
	readonly elapsedMs: number;
	readonly successesBefore: number;
}

interface ProbeGetArgs {
	readonly apiKey: string;
	readonly index: number;
	readonly url: string;
}

function captureRateLimitHeaders(response: Response): Readonly<Record<string, string>> {
	const captured: Record<string, string> = {};
	for (const [name, value] of response.headers.entries()) {
		const lower = name.toLowerCase();
		const isRelevant =
			lower === "retry-after" || lower.includes("ratelimit") || lower.includes("rate-limit");
		if (isRelevant) {
			captured[lower] = value;
		}
	}

	return captured;
}

async function submitTask(credentials: Credentials): Promise<string> {
	const { apiKey, placeId, universeId } = credentials;
	const path = `/cloud/v2/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`;
	const body = JSON.stringify({ script: "return 1" });

	console.log(`\n>>> POST ${path}`);
	console.log(`>>> body: ${body}`);

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

function parseTaskRef(bodyText: string): TaskRef | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return undefined;
	}

	if (parsed === null || typeof parsed !== "object") {
		return undefined;
	}

	const path: unknown = Reflect.get(parsed, "path");
	if (typeof path !== "string") {
		return undefined;
	}

	const match = PATH_PATTERN.exec(path);
	if (match === null) {
		return undefined;
	}

	const [, universeId, placeId, versionId, sessionId, sessionTaskId, plainTaskId] = match;
	const taskId = sessionTaskId ?? plainTaskId;
	if (universeId === undefined || placeId === undefined || taskId === undefined) {
		return undefined;
	}

	return { placeId, sessionId, taskId, universeId, versionId };
}

function buildGetUrl(ref: TaskRef): string | undefined {
	const { placeId, sessionId, taskId, universeId, versionId } = ref;
	if (versionId === undefined || sessionId === undefined) {
		return undefined;
	}

	return `/cloud/v2/universes/${universeId}/places/${placeId}/versions/${versionId}/luau-execution-sessions/${sessionId}/tasks/${taskId}`;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function retryAfterSeconds(value: string | undefined): number {
	if (value === undefined) {
		return DEFAULT_RETRY_AFTER_SECONDS;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? DEFAULT_RETRY_AFTER_SECONDS : parsed;
}

async function probeGet(args: ProbeGetArgs): Promise<GetSample> {
	const { apiKey, index, url } = args;
	const response = await fetch(`${API_BASE}${url}`, {
		headers: { "x-api-key": apiKey },
		method: "GET",
	});
	const time = performance.now();
	// Drain the body so the connection is freed for the next iteration.
	await response.text();

	const headers = captureRateLimitHeaders(response);
	const retryAfter = headers["retry-after"];
	const headerSummary = Object.keys(headers).length === 0 ? "(none)" : JSON.stringify(headers);
	console.log(
		`GET #${(index + 1).toString()} status=${response.status.toString()} headers=${headerSummary}`,
	);

	return { headers, retryAfter, status: response.status, time };
}

async function handleThrottle(sample: GetSample): Promise<void> {
	const seconds = retryAfterSeconds(sample.retryAfter);
	console.log(
		`!!! 429 throttled. retry-after=${sample.retryAfter ?? "(absent)"} ` +
			`headers=${JSON.stringify(sample.headers)} sleeping ${seconds.toString()}s`,
	);
	await sleep(seconds * MS_PER_SECOND);
}

function isSuccess(sample: GetSample): boolean {
	return sample.status >= 200 && sample.status < 300;
}

async function runGetLoop(apiKey: string, url: string): Promise<ReadonlyArray<GetSample>> {
	const samples: Array<GetSample> = [];
	const start = performance.now();
	let throttleCycles = 0;
	// `true` while the previous sample was a 429, so a following 2xx counts
	// as one completed throttle -> recovery cycle.
	let isThrottled = false;

	console.log("\n=== GET loop (sequential, no artificial delay) ===");

	while (
		performance.now() - start < MAX_ELAPSED_MS &&
		samples.length < MAX_TOTAL_GETS &&
		throttleCycles < MAX_THROTTLE_CYCLES
	) {
		const sample = await probeGet({ apiKey, index: samples.length, url });
		samples.push(sample);

		if (sample.status === 429) {
			isThrottled = true;
			await handleThrottle(sample);
			continue;
		}

		if (isThrottled && isSuccess(sample)) {
			throttleCycles += 1;
			isThrottled = false;
			console.log(
				`=== recovered from throttle (cycle ${throttleCycles.toString()}/${MAX_THROTTLE_CYCLES.toString()}) ===`,
			);
		}
	}

	return samples;
}

function maxSuccessesInRollingWindow(samples: ReadonlyArray<GetSample>): number {
	const successTimes = samples
		.filter((sample) => sample.status >= 200 && sample.status < 300)
		.map((sample) => sample.time);

	let best = 0;
	for (const [startIndex, windowStart] of successTimes.entries()) {
		let count = 0;
		for (let index = startIndex; index < successTimes.length; index += 1) {
			const time = successTimes[index];
			if (time !== undefined && time - windowStart < ROLLING_WINDOW_MS) {
				count += 1;
			} else {
				break;
			}
		}

		if (count > best) {
			best = count;
		}
	}

	return best;
}

function firstThrottleStats(samples: ReadonlyArray<GetSample>): FirstThrottle | undefined {
	const first = samples.find((sample) => sample.status === 429);
	if (first === undefined) {
		return undefined;
	}

	const startTime = samples[0]?.time ?? first.time;
	const successesBefore = samples
		.slice(0, samples.indexOf(first))
		.filter((sample) => sample.status >= 200 && sample.status < 300).length;
	return { elapsedMs: first.time - startTime, successesBefore };
}

function distinctHeader(samples: ReadonlyArray<GetSample>, name: string): ReadonlyArray<string> {
	return [
		...new Set(
			samples
				.map((sample) => sample.headers[name])
				.filter((value): value is string => value !== undefined),
		),
	];
}

function shapeVerdict(samples: ReadonlyArray<GetSample>): string {
	const hasThrottled = samples.some((sample) => sample.status === 429);
	if (!hasThrottled) {
		return "INCONCLUSIVE (no 429 observed; never reached the ceiling within caps)";
	}

	const limits = distinctHeader(samples, "x-ratelimit-limit");
	const isWindowed = limits.some((value) => /w=\d+/.test(value));
	return isWindowed
		? `FIXED WINDOW per x-ratelimit-limit=[${limits.join(" | ")}] ` +
				"(x-ratelimit-reset is the true recovery; retry-after understates it)"
		: "UNDETERMINED (no windowed x-ratelimit-limit header observed)";
}

function logFirstThrottle(samples: ReadonlyArray<GetSample>): void {
	const first = firstThrottleStats(samples);
	if (first === undefined) {
		console.log("first 429: never observed within the run caps");
	} else {
		console.log(`successful GETs before first 429: ${first.successesBefore.toString()}`);
		console.log(`elapsed to first 429: ${(first.elapsedMs / MS_PER_SECOND).toFixed(2)}s`);
	}
}

function logHeaderStats(samples: ReadonlyArray<GetSample>): void {
	const distinctRetryAfter = [
		...new Set(
			samples
				.map((sample) => sample.retryAfter)
				.filter((value): value is string => value !== undefined),
		),
	];
	const limitHeaders = distinctHeader(samples, "x-ratelimit-limit");

	console.log(
		`max successful GETs in any rolling 60s window: ${maxSuccessesInRollingWindow(samples).toString()}`,
	);
	console.log(
		`distinct retry-after values seen: ${distinctRetryAfter.length === 0 ? "(none)" : distinctRetryAfter.join(", ")}`,
	);
	console.log(
		`observed x-ratelimit-limit: ${limitHeaders.length === 0 ? "(none)" : limitHeaders.join(" | ")}`,
	);
	console.log(`limiter-shape verdict: ${shapeVerdict(samples)}`);
}

function printSummary(samples: ReadonlyArray<GetSample>): void {
	const totalGets = samples.length;
	const successCount = samples.filter(
		(sample) => sample.status >= 200 && sample.status < 300,
	).length;
	const throttleCount = samples.filter((sample) => sample.status === 429).length;

	console.log("\n========== SUMMARY ==========");
	console.log(`total GETs: ${totalGets.toString()}`);
	console.log(`2xx responses: ${successCount.toString()}`);
	console.log(`429 responses: ${throttleCount.toString()}`);
	logFirstThrottle(samples);
	logHeaderStats(samples);
	console.log(
		"caveat: this measures this API key AND this machine's IP combined " +
			"(the quota is per key-owner OR IP, whichever is hit first). Re-running " +
			"soon may be skewed by an already-drained window.",
	);
	console.log("=============================");
}

async function probe(credentials: Credentials): Promise<void> {
	const createBody = await submitTask(credentials);
	const ref = parseTaskRef(createBody);
	if (ref === undefined) {
		console.error("!!! could not parse a task ref from the create response; aborting");
		process.exit(1);
	}

	const url = buildGetUrl(ref);
	if (url === undefined) {
		console.error(
			"!!! create response path lacked versionId/sessionId; cannot build GET url; aborting",
		);
		process.exit(1);
	}

	console.log(`\n=== target GET url: ${url} ===`);
	const samples = await runGetLoop(credentials.apiKey, url);
	printSummary(samples);
}

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined || PLACE_ID === undefined) {
	console.error("BEDROCK_API_KEY, ROBLOX_TEST_UNIVERSE_ID, and ROBLOX_TEST_PLACE_ID must be set");
	process.exit(1);
}

await probe({ apiKey: API_KEY, placeId: PLACE_ID, universeId: UNIVERSE_ID });
