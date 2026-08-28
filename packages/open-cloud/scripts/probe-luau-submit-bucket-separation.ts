// Empirically determines whether the two Luau Execution submit URL shapes
// share one rate-limit bucket or hold separate ones, and what each
// ceiling is.
//
// Why this probe exists: `src/domains/cloud-v2/luau-execution-tasks/`
// paces both submit shapes from a single 40/min `SUBMIT_OPERATION_LIMIT`,
// on the stated belief that Roblox attributes both to one per-minute
// quota. The vendored OpenAPI disagrees: the head operation
// (`Cloud_CreateLuauExecutionSessionTask__Using_Universes`) carries
// `x-roblox-rate-limits.perApiKeyOwner = 40`, while the version-pinned
// operation (`..._Using_Universes_Places`) carries 5. Both operations'
// prose descriptions say "5 calls per minute per API key owner", so the
// prose and the machine-readable values also disagree for head.
//
// The probe answers two questions from live response headers:
//
//   (a) do the two shapes report different `x-ratelimit-limit` values,
//       and
//   (b) do their `x-ratelimit-remaining` counters move independently, so
//       that pinned traffic does not drain head budget.
//
// How it works: wait for enough headroom in the current window, submit
// once at head (which also reveals the current head version id from the
// response path), submit N times at that pinned version, then submit once
// more at head. If the buckets are separate, head's `remaining` drops by
// exactly the two head calls; if shared, it drops by all N + 2.
//
// Run with:
// ROBLOX_API_KEY=<key with universe.place.luau-execution-session:write> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// ROBLOX_TEST_PLACE_ID=<place id> \
// bun packages/open-cloud/scripts/probe-luau-submit-bucket-separation.ts
//
// The script never writes to the repo. It needs real Open Cloud
// credentials, so it cannot be run in CI.

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

/** Trivial script so each submitted task completes almost immediately. */
const PROBE_SCRIPT = "return 1";

/** Pinned submits issued between the two head reads. */
const PINNED_SUBMITS = 3;

/** Spacing between submits, so the ten-incomplete-tasks cap is not hit. */
const SUBMIT_SPACING_MS = 2000;

/**
 * Seconds of window that must remain before starting, so every submit
 * lands inside one fixed window and the arithmetic on `remaining` holds.
 */
const MIN_WINDOW_HEADROOM_SECONDS = 30;

const MS_PER_SECOND = 1000;

const LABEL_WIDTH = 18;

const SHAPE_WIDTH = 6;

/** Matches the head-submit response path, capturing the resolved version. */
const VERSION_PATH_PATTERN = /^universes\/\d+\/places\/\d+\/versions\/(\d+)\//;

type Shape = "head" | "pinned";

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface Sample {
	readonly bodyText: string;
	readonly limit?: string | undefined;
	readonly remaining?: string | undefined;
	readonly reset?: string | undefined;
	readonly shape: Shape;
	readonly status: number;
}

interface SubmitArguments {
	readonly apiKey: string;
	readonly label: string;
	readonly shape: Shape;
	readonly url: string;
}

interface VerdictArguments {
	readonly headAfter: Sample;
	readonly headBefore: Sample;
	readonly pinned: ReadonlyArray<Sample>;
}

/**
 * Reads the leading numeric token of a comma-joined rate-limit header.
 * Roblox sends two headers of each name (the operation quota and a global
 * one); `fetch` joins them, so `40, 45;w=60, 40;w=60, 70000` arrives as a
 * single string whose first token is the binding value.
 *
 * @param raw - The joined header value, or undefined when absent.
 * @returns The binding value, or undefined when the header was absent.
 */
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

function submitUrl(credentials: Credentials, versionId: string | undefined): string {
	const base = `${API_BASE}/cloud/v2/universes/${credentials.universeId}/places/${credentials.placeId}`;
	return versionId === undefined
		? `${base}/luau-execution-session-tasks`
		: `${base}/versions/${versionId}/luau-execution-session-tasks`;
}

async function submit({ apiKey, label, shape, url }: SubmitArguments): Promise<Sample> {
	const response = await fetch(url, {
		body: JSON.stringify({ script: PROBE_SCRIPT }),
		headers: { "content-type": "application/json", "x-api-key": apiKey },
		method: "POST",
	});
	const bodyText = await response.text();
	const sample: Sample = {
		bodyText,
		limit: leadingValue(response.headers.get("x-ratelimit-limit") ?? undefined),
		remaining: leadingValue(response.headers.get("x-ratelimit-remaining") ?? undefined),
		reset: leadingValue(response.headers.get("x-ratelimit-reset") ?? undefined),
		shape,
		status: response.status,
	};

	console.log(
		`${label.padEnd(LABEL_WIDTH)} shape=${shape.padEnd(SHAPE_WIDTH)} ` +
			`status=${sample.status.toString()} limit=${sample.limit ?? "(none)"} ` +
			`remaining=${sample.remaining ?? "(none)"} reset=${sample.reset ?? "(none)"}`,
	);
	if (sample.status >= 300) {
		console.log(`    body: ${sample.bodyText}`);
	}

	return sample;
}

function parseVersionId(bodyText: string): string | undefined {
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
	if (typeof path !== "string") {
		return undefined;
	}

	return VERSION_PATH_PATTERN.exec(path)?.[1];
}

/**
 * Burns the remainder of the current fixed window when too little of it
 * is left for the whole sequence to land inside one window.
 *
 * @param credentials - Open Cloud key and target place.
 */
async function alignToWindow(credentials: Credentials): Promise<void> {
	const url = `${API_BASE}/cloud/v2/universes/${credentials.universeId}`;
	const response = await fetch(url, { headers: { "x-api-key": credentials.apiKey } });
	await response.text();

	const reset = toNumber(leadingValue(response.headers.get("x-ratelimit-reset") ?? undefined));
	console.log(`window probe: reset=${reset?.toString() ?? "(none)"}s`);
	if (reset === undefined || reset >= MIN_WINDOW_HEADROOM_SECONDS) {
		return;
	}

	console.log(`waiting ${reset.toString()}s for the next window boundary...`);
	await sleep((reset + 1) * MS_PER_SECOND);
}

function reportSeparation({ headAfter, headBefore, pinned }: VerdictArguments): void {
	const beforeRemaining = toNumber(headBefore.remaining);
	const afterRemaining = toNumber(headAfter.remaining);
	const pinnedLimits = [...new Set(pinned.map((sample) => sample.limit ?? "(none)"))];

	console.log("\n========== VERDICT ==========");
	console.log(`head   x-ratelimit-limit: ${headBefore.limit ?? "(none)"}`);
	console.log(`pinned x-ratelimit-limit: ${pinnedLimits.join(" | ")}`);
	console.log(
		`head remaining: ${headBefore.remaining ?? "(none)"} -> ` +
			`${headAfter.remaining ?? "(none)"} across ${PINNED_SUBMITS.toString()} pinned submits`,
	);

	if (beforeRemaining === undefined || afterRemaining === undefined) {
		console.log("bucket separation: INCONCLUSIVE (missing remaining headers)");
	} else if (beforeRemaining - afterRemaining === 1) {
		console.log("bucket separation: SEPARATE (pinned traffic did not drain head budget)");
	} else if (beforeRemaining - afterRemaining === PINNED_SUBMITS + 1) {
		console.log("bucket separation: SHARED (pinned traffic drained head budget)");
	} else {
		console.log("bucket separation: INCONCLUSIVE (unexpected drop; concurrent traffic?)");
	}

	console.log("=============================");
}

async function runPinnedSubmits(
	credentials: Credentials,
	versionId: string,
): Promise<Array<Sample>> {
	const url = submitUrl(credentials, versionId);
	const pinned: Array<Sample> = [];
	for (let index = 0; index < PINNED_SUBMITS; index += 1) {
		await sleep(SUBMIT_SPACING_MS);
		pinned.push(
			await submit({
				apiKey: credentials.apiKey,
				label: `pinned #${(index + 1).toString()}`,
				shape: "pinned",
				url,
			}),
		);
	}

	return pinned;
}

async function probe(credentials: Credentials): Promise<void> {
	await alignToWindow(credentials);
	console.log("\n=== submit sequence ===");

	const headUrl = submitUrl(credentials, undefined);
	const headBefore = await submit({
		apiKey: credentials.apiKey,
		label: "head #1",
		shape: "head",
		url: headUrl,
	});
	const versionId = parseVersionId(headBefore.bodyText);
	if (versionId === undefined) {
		console.error("!!! could not read a version id from the head response; aborting");
		process.exit(1);
	}

	console.log(`resolved head version: ${versionId}`);
	const pinned = await runPinnedSubmits(credentials, versionId);

	await sleep(SUBMIT_SPACING_MS);
	const headAfter = await submit({
		apiKey: credentials.apiKey,
		label: "head #2",
		shape: "head",
		url: headUrl,
	});

	reportSeparation({ headAfter, headBefore, pinned });
}

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined || PLACE_ID === undefined) {
	console.error("ROBLOX_API_KEY, ROBLOX_TEST_UNIVERSE_ID, and ROBLOX_TEST_PLACE_ID must be set");
	process.exit(1);
}

await probe({ apiKey: API_KEY, placeId: PLACE_ID, universeId: UNIVERSE_ID });
