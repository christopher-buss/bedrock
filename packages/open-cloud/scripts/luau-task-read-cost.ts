// Pure analysis for `probe-luau-task-read-cost.ts`. Kept free of I/O so the
// arithmetic that turns raw `x-ratelimit-remaining` readings into a per-read
// cost verdict is unit-tested; the runner only fetches and prints.

const MS_PER_SECOND = 1000;
const TENTHS = 10;
const HALF = 0.5;

/**
 * Matches the two x-aep-resource path shapes a create call may return for a
 * session task; only the version-pinned session shape yields a GET url.
 */
const PATH_PATTERN =
	/^universes\/(\d+)\/places\/(\d+)(?:\/versions\/(\d+))?(?:\/luau-execution-sessions\/([^/]+)\/tasks\/([^/]+)|\/luau-execution-session-tasks\/([^/]+))$/;

/** The ids parsed out of a create response's `path`. */
export interface TaskRef {
	/** Place id segment. */
	readonly placeId: string;
	/** Session id, present only on the session-shaped path. */
	readonly sessionId?: string | undefined;
	/** Task id segment. */
	readonly taskId: string;
	/** Universe id segment. */
	readonly universeId: string;
	/** Version id, present only on the version-pinned path. */
	readonly versionId?: string | undefined;
}

/** One GET on the task with the rate-limit headers it carried. */
export interface ReadSample {
	/** First token of `x-ratelimit-limit`, or `undefined` when absent. */
	readonly limit: number | undefined;
	/**
	 * Smallest token of `x-ratelimit-remaining`, or `undefined` when absent.
	 */
	readonly remaining: number | undefined;
	/** HTTP status code. */
	readonly status: number;
	/** Monotonic ms timestamp at response receipt. */
	readonly timeMs: number;
}

/** A pause with no traffic bracketed by one read on each side. */
export interface IdleObservation {
	/** The read taken after the idle pause. */
	readonly after: ReadSample;
	/** The last read before the idle pause. */
	readonly before: ReadSample | undefined;
}

/** Raw readings from the two probe phases. */
export interface ReadCostInput {
	/** Back-to-back reads with no artificial delay. */
	readonly burst: ReadonlyArray<ReadSample>;
	/** A pause with no traffic followed by one read. */
	readonly idle: IdleObservation;
}

/** What the readings say about the cost of one read. */
export interface ReadCostSummary {
	/** Counter drop between consecutive successful reads inside one window. */
	readonly burstDeltas: ReadonlyArray<number>;
	/** Units the counter lost per second across the burst. */
	readonly burstDropPerSecond: number | undefined;
	/** `limit / unitsPerRead`: reads one window allows at this cost. */
	readonly effectiveReadsPerWindow: number | undefined;
	/**
	 * Units lost per second while this probe sent nothing, net of the one
	 * read that closed the pause.
	 */
	readonly idleDrainPerSecond: number | undefined;
	/** Median counter drop per read. */
	readonly unitsPerRead: number | undefined;
	/** One-line human-readable conclusion. */
	readonly verdict: string;
}

interface CountedSample extends ReadSample {
	readonly remaining: number;
}

interface VerdictParts {
	readonly idleDrainPerSecond: number | undefined;
	readonly limit: number | undefined;
	readonly unitsPerRead: number;
}

/**
 * Extracts the task ids from a create response body.
 *
 * @param bodyText - Raw response body of the create call.
 * @returns The parsed ids, or `undefined` when the body carries no task path.
 */
export function parseTaskRef(bodyText: string): TaskRef | undefined {
	let parsed: JSONValue;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return undefined;
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}

	const { path } = parsed;
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

/**
 * Builds the version-pinned session task GET path.
 *
 * @param ref - Parsed task ids, or `undefined` when parsing failed.
 * @returns The request path, or `undefined` when the ref is not version-pinned.
 */
export function buildGetUrl(ref: TaskRef | undefined): string | undefined {
	if (ref?.versionId === undefined || ref.sessionId === undefined) {
		return undefined;
	}

	return `/cloud/v2/universes/${ref.universeId}/places/${ref.placeId}/versions/${ref.versionId}/luau-execution-sessions/${ref.sessionId}/tasks/${ref.taskId}`;
}

/**
 * Turns the burst and idle readings into a per-read cost verdict.
 *
 * @param input - Readings from both probe phases.
 * @returns The summary the runner prints.
 */
export function summarizeReadCost(input: ReadCostInput): ReadCostSummary {
	const counted = input.burst.filter(isCounted);
	const burstDeltas = consecutiveDrops(counted);
	const unitsPerRead = median(burstDeltas);
	const first = counted[0];
	const last = counted.at(-1);

	if (unitsPerRead === undefined || first === undefined || last === undefined) {
		return {
			burstDeltas,
			burstDropPerSecond: undefined,
			effectiveReadsPerWindow: undefined,
			idleDrainPerSecond: undefined,
			unitsPerRead,
			verdict: "INCONCLUSIVE (fewer than two successful reads)",
		};
	}

	const { limit } = last;
	const idleDrainPerSecond = idleDrain(input.idle, unitsPerRead);
	const totalDrop = burstDeltas.reduce((sum, delta) => sum + delta, 0);
	return {
		burstDeltas,
		burstDropPerSecond: perSecond(totalDrop, last.timeMs - first.timeMs),
		effectiveReadsPerWindow: effectiveReads(limit, unitsPerRead),
		idleDrainPerSecond,
		unitsPerRead,
		verdict: describeVerdict({ idleDrainPerSecond, limit, unitsPerRead }),
	};
}

function isCounted(sample: ReadSample): sample is CountedSample {
	return sample.status >= 200 && sample.status < 300 && sample.remaining !== undefined;
}

/**
 * Drops between consecutive counted reads. A step where the counter rose is a
 * window reset and is skipped rather than folded into the cost.
 *
 * @param samples - Successful reads in the order they were taken.
 * @returns One non-negative drop per consecutive pair.
 */
function consecutiveDrops(samples: ReadonlyArray<CountedSample>): Array<number> {
	const drops: Array<number> = [];
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1];
		const current = samples[index];
		if (previous === undefined || current === undefined) {
			continue;
		}

		const drop = previous.remaining - current.remaining;
		if (drop >= 0) {
			drops.push(drop);
		}
	}

	return drops;
}

function median(values: ReadonlyArray<number>): number | undefined {
	if (values.length === 0) {
		return undefined;
	}

	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const upper = sorted[middle];
	const lower = sorted[middle - 1];
	if (lower === undefined || upper === undefined || sorted.length % 2 === 1) {
		return upper;
	}

	return (lower + upper) * HALF;
}

function effectiveReads(limit: number | undefined, unitsPerRead: number): number | undefined {
	if (limit === undefined || unitsPerRead === 0) {
		return undefined;
	}

	return Math.floor(limit / unitsPerRead);
}

function roundTenths(value: number): number {
	return Math.round(value * TENTHS) / TENTHS;
}

function perSecond(units: number, elapsedMs: number): number | undefined {
	if (elapsedMs <= 0) {
		return undefined;
	}

	return roundTenths((units / elapsedMs) * MS_PER_SECOND);
}

/**
 * Units lost across the pause that this probe did not spend itself: the read
 * that closes the pause costs `unitsPerRead`, so that much is subtracted.
 *
 * @param idle - The reads on either side of the pause.
 * @param unitsPerRead - Cost of the closing read, from the burst.
 * @returns Drain in units per second, or `undefined` when unmeasurable.
 */
function idleDrain({ after, before }: IdleObservation, unitsPerRead: number): number | undefined {
	if (before === undefined || !isCounted(before) || !isCounted(after)) {
		return undefined;
	}

	const drop = before.remaining - after.remaining - unitsPerRead;
	if (drop < 0) {
		return undefined;
	}

	return perSecond(drop, after.timeMs - before.timeMs);
}

function describeVerdict({ idleDrainPerSecond, limit, unitsPerRead }: VerdictParts): string {
	const window = limit === undefined ? "the window" : `the ${limit.toString()} window`;
	const unit = unitsPerRead === 1 ? "unit" : "units";
	const drain =
		idleDrainPerSecond === undefined || idleDrainPerSecond === 0
			? "no background drain observed"
			: `background drain of ${idleDrainPerSecond.toString()} units/s from another consumer on this key or IP`;
	return `each read costs ${unitsPerRead.toString()} ${unit} of ${window}; ${drain}`;
}
