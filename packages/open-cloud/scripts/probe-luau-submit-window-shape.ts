// Empirically determines whether the Luau Execution submit quota is
// enforced as a fixed 60s window or a sliding average, and captures the
// headers a genuine quota 429 carries.
//
// Why this probe exists: a limiter that reasons in sliding averages
// mis-predicts at window edges, and the two models differ in how budget
// returns. Under a fixed window the whole window's spend clears at once
// at the boundary; under a sliding window budget drips back as each
// individual call ages out.
//
// It probes the version-pinned shape because its 5/min ceiling is the
// cheapest one to exhaust. It submits steadily across a window boundary
// and watches for the step where `x-ratelimit-remaining` increases. The
// size of that step is the discriminator: a sliding window can only
// return budget for calls older than 60s, so a counter restored to its
// full ceiling while our own recent calls are still inside the trailing
// minute can only be a fixed window clearing the whole window's spend.
//
// Run with:
// ROBLOX_API_KEY=<key with universe.place.luau-execution-session:write> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// ROBLOX_TEST_PLACE_ID=<place id> \
// bun packages/open-cloud/scripts/probe-luau-submit-window-shape.ts
//
// The script never writes to the repo. It needs real Open Cloud
// credentials, so it cannot be run in CI.

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

const PROBE_SCRIPT = "return 1";

/** Hard cap on submits so the loop cannot run away. */
const MAX_SUBMITS = 60;

const SUBMIT_SPACING_MS = 1500;

/** Spacing after a 429, long enough to walk into the next window. */
const THROTTLED_SPACING_MS = 10_000;

const ROLLING_WINDOW_MS = 60_000;

const LABEL_WIDTH = 12;

/** Matches the head-submit response path, capturing the resolved version. */
const VERSION_PATH_PATTERN = /^universes\/\d+\/places\/\d+\/versions\/(\d+)\//;

const TOO_MANY_REQUESTS = 429;

const OK = 200;

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface Sample {
	readonly bodyText: string;
	readonly envoyRateLimited: boolean;
	readonly limit?: string | undefined;
	readonly remaining?: string | undefined;
	readonly reset?: string | undefined;
	readonly retryAfter?: string | undefined;
	readonly status: number;
	/** Monotonic `performance.now()` timestamp at response receipt. */
	readonly time: number;
}

interface WindowCrossing {
	/** `remaining` on the last sample before the crossing. */
	readonly from: number;
	/** Ceiling reported by `x-ratelimit-limit` at the crossing. */
	readonly limit: number;
	/** Successful submits this run made inside the trailing 60s. */
	readonly recentOwn: number;
	/** `remaining` on the sample that crossed the boundary. */
	readonly to: number;
}

interface PinnedTarget {
	readonly apiKey: string;
	readonly url: string;
}

interface ReportArguments {
	readonly crossing: undefined | WindowCrossing;
	readonly throttled: Sample | undefined;
}

function leadingValue(raw: string | undefined): string | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const [first] = raw.split(",", 1);
	return first?.trim();
}

function toNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function submitPinned(target: PinnedTarget, label: string): Promise<Sample> {
	const response = await fetch(target.url, {
		body: JSON.stringify({ script: PROBE_SCRIPT }),
		headers: { "content-type": "application/json", "x-api-key": target.apiKey },
		method: "POST",
	});
	const bodyText = await response.text();
	const sample: Sample = {
		bodyText,
		envoyRateLimited: response.headers.get("x-envoy-ratelimited") !== null,
		limit: leadingValue(response.headers.get("x-ratelimit-limit") ?? undefined),
		remaining: leadingValue(response.headers.get("x-ratelimit-remaining") ?? undefined),
		reset: leadingValue(response.headers.get("x-ratelimit-reset") ?? undefined),
		retryAfter: response.headers.get("retry-after") ?? undefined,
		status: response.status,
		time: performance.now(),
	};

	console.log(
		`${label.padEnd(LABEL_WIDTH)} status=${sample.status.toString()} ` +
			`limit=${sample.limit ?? "(none)"} remaining=${sample.remaining ?? "(none)"} ` +
			`reset=${sample.reset ?? "(none)"} retry-after=${sample.retryAfter ?? "(none)"} ` +
			`envoy=${String(sample.envoyRateLimited)}`,
	);
	if (sample.status >= 300) {
		console.log(`    body: ${sample.bodyText}`);
	}

	return sample;
}

/**
 * Discovers the place's current head version id by submitting one task at
 * head and reading the resolved version out of the response path. The
 * place resource does not expose a version, and this spends from the
 * 40/min head bucket rather than the 5/min pinned one under test.
 *
 * @param credentials - Open Cloud key and target place.
 * @returns The head version id, or undefined when the path did not carry one.
 */
async function resolveHeadVersion(credentials: Credentials): Promise<string | undefined> {
	const url = `${API_BASE}/cloud/v2/universes/${credentials.universeId}/places/${credentials.placeId}/luau-execution-session-tasks`;
	const response = await fetch(url, {
		body: JSON.stringify({ script: PROBE_SCRIPT }),
		headers: { "content-type": "application/json", "x-api-key": credentials.apiKey },
		method: "POST",
	});
	const bodyText = await response.text();

	let parsed: JSONValue;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return undefined;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}

	const path = Reflect.get(parsed, "path");
	return typeof path === "string" ? VERSION_PATH_PATTERN.exec(path)?.[1] : undefined;
}

/**
 * Counts prior successful submits still inside the trailing 60s. Under a
 * sliding window these all still hold budget, so they bound how much
 * budget could legitimately have returned.
 *
 * @param samples - Every response observed so far, oldest first.
 * @param now - Timestamp to measure the trailing minute back from.
 * @returns How many successful submits are still inside the trailing 60s.
 */
function recentSuccesses(samples: ReadonlyArray<Sample>, now: number): number {
	return samples.filter((sample) => sample.status === OK && now - sample.time < ROLLING_WINDOW_MS)
		.length;
}

function reportThrottle(throttled: Sample | undefined): void {
	if (throttled === undefined) {
		console.log("quota 429: not observed in this run");
		return;
	}

	console.log(
		`quota 429: remaining=${throttled.remaining ?? "(none)"} ` +
			`reset=${throttled.reset ?? "(none)"}s ` +
			`retry-after=${throttled.retryAfter ?? "(none)"}s ` +
			`x-envoy-ratelimited=${String(throttled.envoyRateLimited)}`,
	);
	console.log(`    body: ${throttled.bodyText}`);
}

function reportWindowShape({ crossing, throttled }: ReportArguments): void {
	console.log("\n========== VERDICT ==========");
	console.log(
		"note: `retry-after` is a constant 5s and understates the real wait; " +
			"`x-ratelimit-reset` is the true time to the window edge.",
	);
	reportThrottle(throttled);

	if (crossing === undefined) {
		console.log("window shape: INCONCLUSIVE (no boundary crossing observed)");
		console.log("=============================");
		return;
	}

	console.log(
		`boundary crossing: remaining ${crossing.from.toString()} -> ${crossing.to.toString()} ` +
			`(counter back to ${(crossing.to + 1).toString()} of ${crossing.limit.toString()} ` +
			"before the crossing call spent one)",
	);
	console.log(`own successes still inside the trailing 60s: ${crossing.recentOwn.toString()}`);

	if (crossing.recentOwn > 0 && crossing.to + 1 === crossing.limit) {
		console.log(
			"window shape: FIXED WINDOW (counter reset to its full ceiling while " +
				`${crossing.recentOwn.toString()} of our calls were still inside the ` +
				"trailing 60s, which a sliding window cannot do)",
		);
	} else {
		console.log("window shape: INCONCLUSIVE (counter did not return to its full ceiling)");
	}

	console.log("=============================");
}

function detectCrossing(
	samples: ReadonlyArray<Sample>,
	sample: Sample,
): undefined | WindowCrossing {
	const previousRemaining = toNumber(samples.at(-1)?.remaining);
	const currentRemaining = toNumber(sample.remaining);
	if (
		previousRemaining === undefined ||
		currentRemaining === undefined ||
		currentRemaining <= previousRemaining
	) {
		return undefined;
	}

	return {
		from: previousRemaining,
		limit: toNumber(sample.limit) ?? 0,
		recentOwn: recentSuccesses(samples, sample.time),
		to: currentRemaining,
	};
}

async function runSubmitLoop(target: PinnedTarget): Promise<ReportArguments> {
	const samples: Array<Sample> = [];
	let crossing: undefined | WindowCrossing;
	let throttled: Sample | undefined;

	for (let index = 0; index < MAX_SUBMITS; index += 1) {
		const sample = await submitPinned(target, `submit #${(index + 1).toString()}`);
		throttled ??= sample.status === TOO_MANY_REQUESTS ? sample : undefined;
		crossing ??= detectCrossing(samples, sample);
		if (crossing !== undefined && samples.at(-1) !== undefined) {
			console.log("    ^ window boundary crossed");
		}

		samples.push(sample);
		if (crossing !== undefined && throttled !== undefined) {
			break;
		}

		await sleep(sample.status === TOO_MANY_REQUESTS ? THROTTLED_SPACING_MS : SUBMIT_SPACING_MS);
	}

	return { crossing, throttled };
}

async function probe(credentials: Credentials): Promise<void> {
	const versionId = await resolveHeadVersion(credentials);
	if (versionId === undefined) {
		console.error("!!! could not read a version id from the head response; aborting");
		process.exit(1);
	}

	console.log(`head version: ${versionId}`);
	console.log("\n=== submitting across a window boundary ===");

	const url = `${API_BASE}/cloud/v2/universes/${credentials.universeId}/places/${credentials.placeId}/versions/${versionId}/luau-execution-session-tasks`;
	reportWindowShape(await runSubmitLoop({ apiKey: credentials.apiKey, url }));
}

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined || PLACE_ID === undefined) {
	console.error("ROBLOX_API_KEY, ROBLOX_TEST_UNIVERSE_ID, and ROBLOX_TEST_PLACE_ID must be set");
	process.exit(1);
}

await probe({ apiKey: API_KEY, placeId: PLACE_ID, universeId: UNIVERSE_ID });
