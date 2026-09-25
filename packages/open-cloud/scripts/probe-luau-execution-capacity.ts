// Determines whether a stale `PROCESSING` Luau Execution task holds one
// of a place's ten documented incomplete-task slots.
//
// Why this probe exists: Roblox caps each place at ten incomplete Luau
// Execution tasks. A task that has outlived its deadline but still
// reports `PROCESSING` (christopher-buss/bedrock#622, #623, #624) may
// or may not be counted against that cap. If it is, every stale task
// permanently shrinks the place's capacity, which is a separate Roblox
// bug from the state-machine one. If it is not, there is no capacity
// bug to report.
//
// The probe runs one submission schedule in one of two modes:
//
//   control  a clean place with no incomplete tasks. Expect ten filler
//            tasks accepted and the eleventh rejected with the
//            capacity-specific 429.
//   stale    a place holding exactly one naturally stuck task, named by
//            `ROBLOX_STALE_TASK_PATH`. If the stale task holds a slot,
//            only nine fillers are accepted and the tenth is rejected.
//
// Each filler is a finite, known-good script that holds its slot for
// `FILLER_HOLD_SECONDS` and then returns, under a task `timeout` a
// little longer than the hold. Every filler is therefore guaranteed a
// terminal state either way, and the probe waits for it before exiting
// so the run leaves nothing behind but the prerequisite stale task.
//
// Quota: both submit shapes advertise 5 creates per minute in one fixed
// window (docs/spikes/luau-submit-rate-limits). Ten submits in one
// window therefore need both shapes, so the probe submits once at head
// to resolve the version, five times pinned to that version, four more
// at head, waits for the window edge, and submits an eleventh pinned.
// Every head response path carries the version it resolved to; the
// probe requires it to equal the pinned version so all fillers are
// proven to target one concrete version.
//
// A quota 429 (`x-envoy-ratelimited: true`, `remaining` 0, no
// `RESOURCE_EXHAUSTED` code) is a schedule failure and makes the run
// inconclusive. A capacity 429 carries `code: "RESOURCE_EXHAUSTED"`
// with quota `remaining` still non-zero.
//
// Run with:
// ROBLOX_API_KEY=<key with universe.place.luau-execution-session:read + :write> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// ROBLOX_TEST_PLACE_ID=<disposable place id with no other submitters> \
// [ROBLOX_STALE_TASK_PATH=universes/.../tasks/<id>] \
// [PROBE_EVIDENCE_PATH=<file>] \
// bun packages/open-cloud/scripts/probe-luau-execution-capacity.ts
//
// The script never writes to the repo. Full response bodies, headers and
// task paths go to the evidence file (default: a timestamped JSON file in
// the OS temp dir), which must be kept private. Stdout redacts task ids.
// It needs real Open Cloud credentials, so it cannot be run in CI.

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const API_BASE = "https://apis.roblox.com";

/** Roblox's documented cap on incomplete tasks per place. */
const DOCUMENTED_CAPACITY = 10;

/** Submits planned: the cap plus one, so the boundary is observed. */
const PLANNED_SUBMITS = DOCUMENTED_CAPACITY + 1;

/** Submits at the pinned shape inside the first window (its quota). */
const PINNED_PER_WINDOW = 5;

/** How long each filler keeps its slot before returning. */
const FILLER_HOLD_SECONDS = 120;

/**
 * Task deadline; a filler that fails to return still reaches a terminal state.
 */
const FILLER_TIMEOUT_SECONDS = FILLER_HOLD_SECONDS + 30;

/** Finite, known-good filler. `task.wait` is the only thing it does. */
const FILLER_SCRIPT = `task.wait(${FILLER_HOLD_SECONDS.toString()}) return "filler"`;

const SUBMIT_SPACING_MS = 2000;

/**
 * Seconds of window that must remain before the first submit, so the
 * ten first-window submits all land inside one fixed window.
 */
const MIN_WINDOW_HEADROOM_SECONDS = 30;

/** Cadence of the cleanup poll over each accepted filler. */
const CLEANUP_POLL_MS = 5000;

/** Slack past the filler deadline before cleanup gives up on a task. */
const CLEANUP_GRACE_SECONDS = 60;

const MS_PER_SECOND = 1000;

const LABEL_WIDTH = 12;

const SHAPE_WIDTH = 6;

const OK = 200;

const REDIRECTION = 300;

const TOO_MANY_REQUESTS = 429;

/** Trailing characters of a task id shown on stdout. */
const REDACTED_ID_SUFFIX = 6;

/** Matches a task resource path, capturing the version segment. */
const VERSION_PATH_PATTERN = /^universes\/\d+\/places\/\d+\/versions\/(\d+)\//;

const TERMINAL_STATES: ReadonlySet<string> = new Set(["CANCELLED", "COMPLETE", "FAILED"]);

type Shape = "head" | "pinned";

type Rejection = "capacity" | "quota" | "unexpected";

type Verdict =
	| "CONTROL BOUNDARY CONFIRMED"
	| "CONTROL BOUNDARY DIFFERS"
	| "INCONCLUSIVE"
	| "INVALID"
	| "STALE CONSUMES CAPACITY"
	| "STALE DOES NOT CONSUME CAPACITY";

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface Sample {
	readonly bodyText: string;
	readonly envoyRateLimited: boolean;
	readonly label: string;
	readonly limit?: string | undefined;
	readonly path?: string | undefined;
	readonly remaining?: string | undefined;
	readonly reset?: string | undefined;
	readonly retryAfter?: string | undefined;
	readonly shape: Shape;
	readonly status: number;
	/** Wall-clock ISO timestamp at response receipt. */
	readonly time: string;
}

interface TaskSnapshot {
	readonly bodyText: string;
	readonly createTime?: string | undefined;
	readonly path: string;
	readonly state?: string | undefined;
	readonly status: number;
	readonly time: string;
	readonly updateTime?: string | undefined;
}

interface SubmitArguments {
	readonly credentials: Credentials;
	readonly label: string;
	readonly shape: Shape;
	readonly versionId: string | undefined;
}

interface ScheduleResult {
	/** Index (1-based) of the first submit rejected for capacity. */
	readonly capacityRejectedAt: number | undefined;
	readonly quotaRejected: boolean;
	readonly samples: ReadonlyArray<Sample>;
	readonly versionId: string | undefined;
	readonly versionMismatch: boolean;
}

/** Mutable accumulator for one pass over the submission schedule. */
interface ScheduleState {
	capacityRejectedAt: number | undefined;
	quotaRejected: boolean;
	readonly samples: Array<Sample>;
	versionId: string | undefined;
	versionMismatch: boolean;
}

interface Observations {
	readonly cleanup: ReadonlyArray<TaskSnapshot>;
	readonly mode: "control" | "stale";
	readonly schedule: ScheduleResult;
	readonly staleAfter: TaskSnapshot | undefined;
	readonly staleBefore: TaskSnapshot | undefined;
}

interface Evidence extends Observations {
	readonly verdict: Verdict;
}

interface SampleSource {
	readonly bodyText: string;
	readonly label: string;
	readonly shape: Shape;
}

function nowIso(): string {
	const now = new Date();
	return now.toISOString();
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

function parseObject(bodyText: string): Record<string, unknown> | undefined {
	let parsed: JSONValue;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return undefined;
	}

	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? parsed
		: undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

/**
 * Shortens a task resource path for stdout so a pasted log does not
 * leak the full private identifier. The evidence file keeps it whole.
 *
 * @param path - Full task resource path, or undefined when absent.
 * @returns The path with the task id reduced to its trailing characters.
 */
function redactPath(path: string | undefined): string {
	if (path === undefined) {
		return "(none)";
	}

	const slash = path.lastIndexOf("/");
	const id = path.slice(slash + 1);
	return `${path.slice(0, slash + 1)}…${id.slice(-REDACTED_ID_SUFFIX)}`;
}

function isAccepted(sample: Sample): boolean {
	return sample.status >= OK && sample.status < REDIRECTION;
}

/**
 * Classifies a rejected submit. The edge proxy's quota 429 announces
 * itself with `x-envoy-ratelimited` and an empty error code; the
 * capacity cap answers from the service with `RESOURCE_EXHAUSTED` and
 * the quota counter still above zero.
 *
 * @param sample - A submit response with a non-2xx status.
 * @returns Which limit produced the rejection.
 */
function classifyRejection(sample: Sample): Rejection {
	if (sample.status !== TOO_MANY_REQUESTS) {
		return "unexpected";
	}

	const code = readString(parseObject(sample.bodyText), "code");
	if (code === "RESOURCE_EXHAUSTED" && !sample.envoyRateLimited) {
		return "capacity";
	}

	return "quota";
}

function submitUrl(credentials: Credentials, versionId: string | undefined): string {
	const base = `${API_BASE}/cloud/v2/universes/${credentials.universeId}/places/${credentials.placeId}`;
	return versionId === undefined
		? `${base}/luau-execution-session-tasks`
		: `${base}/versions/${versionId}/luau-execution-session-tasks`;
}

function toSample(response: Response, { bodyText, label, shape }: SampleSource): Sample {
	return {
		bodyText,
		envoyRateLimited: response.headers.has("x-envoy-ratelimited"),
		label,
		limit: leadingValue(response.headers.get("x-ratelimit-limit") ?? undefined),
		path: readString(parseObject(bodyText), "path"),
		remaining: leadingValue(response.headers.get("x-ratelimit-remaining") ?? undefined),
		reset: leadingValue(response.headers.get("x-ratelimit-reset") ?? undefined),
		retryAfter: response.headers.get("retry-after") ?? undefined,
		shape,
		status: response.status,
		time: nowIso(),
	};
}

function logSample(sample: Sample): void {
	console.log(
		`${sample.label.padEnd(LABEL_WIDTH)} shape=${sample.shape.padEnd(SHAPE_WIDTH)} ` +
			`status=${sample.status.toString()} limit=${sample.limit ?? "(none)"} ` +
			`remaining=${sample.remaining ?? "(none)"} reset=${sample.reset ?? "(none)"} ` +
			`envoy=${String(sample.envoyRateLimited)} task=${redactPath(sample.path)}`,
	);
	if (!isAccepted(sample)) {
		console.log(`    rejection=${classifyRejection(sample)} body: ${sample.bodyText}`);
	}
}

async function submit({ credentials, label, shape, versionId }: SubmitArguments): Promise<Sample> {
	const response = await fetch(submitUrl(credentials, versionId), {
		body: JSON.stringify({
			script: FILLER_SCRIPT,
			timeout: `${FILLER_TIMEOUT_SECONDS.toString()}s`,
		}),
		headers: { "content-type": "application/json", "x-api-key": credentials.apiKey },
		method: "POST",
	});
	const sample = toSample(response, { bodyText: await response.text(), label, shape });
	logSample(sample);
	return sample;
}

async function readTask(credentials: Credentials, path: string): Promise<TaskSnapshot> {
	const response = await fetch(`${API_BASE}/cloud/v2/${path}`, {
		headers: { "x-api-key": credentials.apiKey },
	});
	const bodyText = await response.text();
	const body = parseObject(bodyText);
	return {
		bodyText,
		createTime: readString(body, "createTime"),
		path,
		state: readString(body, "state"),
		status: response.status,
		time: nowIso(),
		updateTime: readString(body, "updateTime"),
	};
}

function isTerminal(snapshot: TaskSnapshot): boolean {
	return snapshot.state !== undefined && TERMINAL_STATES.has(snapshot.state);
}

/**
 * Burns the remainder of the current fixed window when too little of it
 * is left for the whole first-window sequence to land inside one window.
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

/**
 * Waits out the window the last sample reported so the next submit
 * draws from fresh quota. `x-ratelimit-reset` is the true time to the
 * edge; `retry-after` is a constant that understates it.
 *
 * @param last - The most recent submit response.
 */
async function waitForWindowEdge(last: Sample | undefined): Promise<void> {
	const reset = toNumber(last?.reset);
	const seconds = reset === undefined ? MIN_WINDOW_HEADROOM_SECONDS : reset + 1;
	console.log(`waiting ${seconds.toString()}s for the window edge before the final submit...`);
	await sleep(seconds * MS_PER_SECOND);
}

/**
 * Picks the URL shape for the n-th submit. The first is head, which
 * reveals the version; the next five are pinned; the remaining
 * first-window submits are head; the final one is pinned in the second
 * window. The head budget (5) covers indices 1 and 7 through 10.
 *
 * @param index - 1-based submit index.
 * @returns Which URL shape that submit uses.
 */
function shapeFor(index: number): Shape {
	if (index === 1 || index > PINNED_PER_WINDOW + 1) {
		return index === PLANNED_SUBMITS ? "pinned" : "head";
	}

	return "pinned";
}

async function pauseBefore(index: number, samples: ReadonlyArray<Sample>): Promise<void> {
	if (index === PLANNED_SUBMITS) {
		await waitForWindowEdge(samples.at(-1));
	} else if (index > 1) {
		await sleep(SUBMIT_SPACING_MS);
	}
}

/**
 * Records an accepted submit: the first one fixes the run's version, and
 * every later one must resolve to the same version or the fillers are
 * not proven to share one concrete place version.
 *
 * @param state - Schedule accumulator to update.
 * @param sample - An accepted submit response.
 */
function recordAccepted(state: ScheduleState, sample: Sample): void {
	const resolved =
		sample.path === undefined ? undefined : VERSION_PATH_PATTERN.exec(sample.path)?.[1];
	state.versionId ??= resolved;
	if (resolved !== state.versionId) {
		console.log(
			`    ^ version mismatch: ${resolved ?? "(none)"} vs ${state.versionId ?? "(none)"}`,
		);
		state.versionMismatch = true;
	}
}

/**
 * Records a rejected submit and reports whether the schedule can go on.
 * It never can: a capacity 429 is the observation the run exists for,
 * and a quota 429 means the schedule is wrong.
 *
 * @param state - Schedule accumulator, with the rejected sample already
 *   pushed so its 1-based index is the sample count.
 * @param sample - A rejected submit response.
 */
function recordRejected(state: ScheduleState, sample: Sample): void {
	if (classifyRejection(sample) === "capacity") {
		state.capacityRejectedAt = state.samples.length;
	} else {
		state.quotaRejected = true;
	}
}

async function runSchedule(credentials: Credentials): Promise<ScheduleResult> {
	const state: ScheduleState = {
		capacityRejectedAt: undefined,
		quotaRejected: false,
		samples: [],
		versionId: undefined,
		versionMismatch: false,
	};

	for (let index = 1; index <= PLANNED_SUBMITS; index += 1) {
		await pauseBefore(index, state.samples);
		const shape = shapeFor(index);
		if (shape === "pinned" && state.versionId === undefined) {
			console.error("!!! no version resolved from the head response; aborting schedule");
			break;
		}

		const sample = await submit({
			credentials,
			label: `submit #${index.toString()}`,
			shape,
			versionId: shape === "pinned" ? state.versionId : undefined,
		});
		state.samples.push(sample);
		if (!isAccepted(sample)) {
			recordRejected(state, sample);
			break;
		}

		recordAccepted(state, sample);
	}

	return state;
}

/**
 * Reads every pending filler once, dropping the ones that reached a
 * terminal state from the pending map.
 *
 * @param credentials - Open Cloud key and target place.
 * @param pending - Task paths still incomplete, mapped to their last snapshot.
 * @returns The snapshots that turned terminal on this pass.
 */
async function pollPending(
	credentials: Credentials,
	pending: Map<string, TaskSnapshot | undefined>,
): Promise<Array<TaskSnapshot>> {
	const finished: Array<TaskSnapshot> = [];
	for (const path of [...pending.keys()]) {
		const snapshot = await readTask(credentials, path);
		pending.set(path, snapshot);
		if (isTerminal(snapshot)) {
			console.log(`terminal   ${snapshot.state ?? "(none)"} ${redactPath(path)}`);
			finished.push(snapshot);
			pending.delete(path);
		}
	}

	return finished;
}

/**
 * Polls every accepted filler until it reaches a terminal state or the
 * grace period past its deadline expires. The run must not end while a
 * filler is still incomplete: it would be indistinguishable from a
 * stale task in a later run.
 *
 * @param credentials - Open Cloud key and target place.
 * @param samples - Every submit response from the schedule.
 * @returns The final snapshot of each accepted filler.
 */
async function cleanup(
	credentials: Credentials,
	samples: ReadonlyArray<Sample>,
): Promise<Array<TaskSnapshot>> {
	const pending = new Map<string, TaskSnapshot | undefined>();
	for (const sample of samples) {
		if (isAccepted(sample) && sample.path !== undefined) {
			pending.set(sample.path, undefined);
		}
	}

	console.log(`\n=== cleanup: waiting on ${pending.size.toString()} filler task(s) ===`);
	const deadline = Date.now() + (FILLER_TIMEOUT_SECONDS + CLEANUP_GRACE_SECONDS) * MS_PER_SECOND;
	const finished: Array<TaskSnapshot> = [];

	while (pending.size > 0 && Date.now() < deadline) {
		finished.push(...(await pollPending(credentials, pending)));
		if (pending.size > 0) {
			await sleep(CLEANUP_POLL_MS);
		}
	}

	for (const [path, snapshot] of pending) {
		console.log(
			`!!! still incomplete after grace: ${snapshot?.state ?? "(unread)"} ${redactPath(path)}`,
		);
		finished.push(snapshot ?? (await readTask(credentials, path)));
	}

	return finished;
}

function reportStale(label: string, snapshot: TaskSnapshot | undefined): void {
	if (snapshot === undefined) {
		return;
	}

	const created = snapshot.createTime === undefined ? undefined : Date.parse(snapshot.createTime);
	const ageMinutes =
		created === undefined
			? "(unknown)"
			: Math.round((Date.now() - created) / MS_PER_SECOND / 60).toString();
	console.log(
		`stale ${label.padEnd(LABEL_WIDTH)} status=${snapshot.status.toString()} ` +
			`state=${snapshot.state ?? "(none)"} age=${ageMinutes}min ` +
			`updated=${snapshot.updateTime ?? "(none)"} task=${redactPath(snapshot.path)}`,
	);
}

function decideStale({ schedule, staleAfter, staleBefore }: Observations): Verdict {
	if (
		staleBefore?.state !== "PROCESSING" ||
		(staleAfter !== undefined && isTerminal(staleAfter))
	) {
		return "INVALID";
	}

	if (schedule.quotaRejected || schedule.versionMismatch || schedule.versionId === undefined) {
		return "INCONCLUSIVE";
	}

	if (schedule.capacityRejectedAt === DOCUMENTED_CAPACITY) {
		return "STALE CONSUMES CAPACITY";
	}

	if (
		schedule.capacityRejectedAt === undefined ||
		schedule.capacityRejectedAt > DOCUMENTED_CAPACITY
	) {
		return "STALE DOES NOT CONSUME CAPACITY";
	}

	return "INCONCLUSIVE";
}

function decideControl(schedule: ScheduleResult): Verdict {
	if (schedule.quotaRejected || schedule.versionMismatch || schedule.versionId === undefined) {
		return "INCONCLUSIVE";
	}

	return schedule.capacityRejectedAt === PLANNED_SUBMITS
		? "CONTROL BOUNDARY CONFIRMED"
		: "CONTROL BOUNDARY DIFFERS";
}

function reportVerdict(evidence: Evidence): void {
	const { cleanup: cleaned, schedule, verdict } = evidence;
	const accepted = schedule.samples.filter((sample) => isAccepted(sample)).length;
	const unfinished = cleaned.filter((snapshot) => !isTerminal(snapshot)).length;

	console.log("\n========== VERDICT ==========");
	console.log(`mode: ${evidence.mode}`);
	console.log(
		`version: ${schedule.versionId ?? "(none)"} mismatch=${String(schedule.versionMismatch)}`,
	);
	console.log(
		`accepted: ${accepted.toString()} of ${schedule.samples.length.toString()} submitted ` +
			`(planned ${PLANNED_SUBMITS.toString()})`,
	);
	console.log(
		`first capacity 429 at submit: ${schedule.capacityRejectedAt?.toString() ?? "(none)"} ` +
			`quota 429 seen: ${String(schedule.quotaRejected)}`,
	);
	reportStale("before", evidence.staleBefore);
	reportStale("after", evidence.staleAfter);
	console.log(
		`cleanup: ${(cleaned.length - unfinished).toString()} terminal, ${unfinished.toString()} still incomplete`,
	);
	console.log(`verdict: ${verdict}`);
	console.log("=============================");
}

async function probe(credentials: Credentials, stalePath: string | undefined): Promise<Evidence> {
	const mode = stalePath === undefined ? "control" : "stale";
	console.log(`mode: ${mode}`);

	const staleBefore =
		stalePath === undefined ? undefined : await readTask(credentials, stalePath);
	reportStale("before", staleBefore);
	if (staleBefore !== undefined && staleBefore.state !== "PROCESSING") {
		console.error("!!! stale task is not PROCESSING; nothing to test");
	}

	await alignToWindow(credentials);
	console.log("\n=== submit schedule ===");
	const schedule = await runSchedule(credentials);

	const staleAfter = stalePath === undefined ? undefined : await readTask(credentials, stalePath);
	const cleaned = await cleanup(credentials, schedule.samples);

	const observations: Observations = {
		cleanup: cleaned,
		mode,
		schedule,
		staleAfter,
		staleBefore,
	};
	const verdict = mode === "stale" ? decideStale(observations) : decideControl(schedule);
	return { ...observations, verdict };
}

const API_KEY = process.env["ROBLOX_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];
if (API_KEY === undefined || UNIVERSE_ID === undefined || PLACE_ID === undefined) {
	console.error("ROBLOX_API_KEY, ROBLOX_TEST_UNIVERSE_ID, and ROBLOX_TEST_PLACE_ID must be set");
	process.exit(1);
}

const STALE_TASK_PATH = process.env["ROBLOX_STALE_TASK_PATH"];
if (
	STALE_TASK_PATH !== undefined &&
	!STALE_TASK_PATH.startsWith(`universes/${UNIVERSE_ID}/places/${PLACE_ID}/`)
) {
	console.error("ROBLOX_STALE_TASK_PATH must be a task path under the target universe and place");
	process.exit(1);
}

const EVIDENCE_PATH =
	process.env["PROBE_EVIDENCE_PATH"] ??
	join(tmpdir(), `luau-execution-capacity-${nowIso().replaceAll(":", "-")}.json`);

const evidence = await probe(
	{ apiKey: API_KEY, placeId: PLACE_ID, universeId: UNIVERSE_ID },
	STALE_TASK_PATH,
);
reportVerdict(evidence);
await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, undefined, "\t"));
console.log(`evidence (private, full identifiers): ${EVIDENCE_PATH}`);
