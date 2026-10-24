// Reproduction attempt for christopher-buss/bedrock#622: a Luau Execution
// task whose script is proven to have started (it wrote a MemoryStore
// marker) but whose native resource stays `PROCESSING` past the requested
// `timeout`. Roblox documents that such a task ends `FAILED /
// DEADLINE_EXCEEDED`; a task that never leaves `PROCESSING` after its
// marker appeared is the red result this probe exists to catch.
//
// The ladder, every task pinned to one immutable place version:
//   bootstrap  `return 0` at head, only to learn the current version id
//              (skipped when ROBLOX_TEST_PLACE_VERSION_ID is set)
//   control    writes `control-started` + `control-finished`, returns
//   yielding   writes `yielding-started`, then `while true do task.wait(1) end`
//   busy       writes `busy-started`, then `while true do end`
//
// Every task asks for a 5 second timeout and is polled once per second for
// at most 60 seconds with raw `fetch` (no SDK, no retries, one abort signal
// per request). The run stops at the first stage that does not pass:
// Open Cloud has no cancellation, so a non-terminal task is never stacked
// on. All logic lives in `luau-deadline-overrun.ts` and is unit-tested;
// this file only reads the environment and writes the artifacts.
//
// Run with (Bun loads `.env` from the working directory):
//
//   OCALE_PROBE_DISPOSABLE_PLACE=<place id> \
//   ROBLOX_API_KEY=<key with luau-execution-session:write,read and
//                   memory-store-sorted-map-item:read> \
//   ROBLOX_TEST_UNIVERSE_ID=<universe id> \
//   ROBLOX_TEST_PLACE_ID=<place id> \
//   bun packages/open-cloud/scripts/probe-luau-deadline-overrun.ts
//
// `OCALE_PROBE_DISPOSABLE_PLACE` must equal the place id: it is the
// operator's statement that the place is disposable and has no other
// submitters. Artifacts:
//   packages/open-cloud/reports/luau-deadline-overrun/<run>.private.jsonl
//     every record verbatim, including full task paths (gitignored)
//   docs/spikes/luau-deadline-overrun/evidence/<run>.jsonl
//     the same records with session/task ids replaced by pseudonyms (commit this)

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
	type ProbeDeps,
	type ProbeRecord,
	redactRecord,
	resolveProbeConfig,
	runProbeAsync,
	type RunSummary,
	toJsonl,
} from "./luau-deadline-overrun.ts";

const RADIX_36 = 36;
const RUN_SUFFIX_LENGTH = 8;

const PRIVATE_DIRECTORY = fileURLToPath(
	new URL("../reports/luau-deadline-overrun/", import.meta.url),
);
const EVIDENCE_DIRECTORY = fileURLToPath(
	new URL("../../../docs/spikes/luau-deadline-overrun/evidence/", import.meta.url),
);

function describeRecord({ detail, event, stage }: ProbeRecord): string {
	switch (event) {
		case "marker": {
			return `${stage} marker ${String(detail["marker"])} status=${String(detail["status"])}`;
		}
		case "submit": {
			return `${stage} submit status=${String(detail["status"])}`;
		}
		case "summary": {
			return `run ${String(detail["colour"])}`;
		}
		case "task": {
			const errorCode =
				typeof detail["errorCode"] === "string" ? ` error=${detail["errorCode"]}` : "";
			return `${stage} task status=${String(detail["status"])} state=${String(detail["state"])}${errorCode}`;
		}
		case "verdict": {
			return `${stage} verdict ${String(detail["verdict"])} after ${String(detail["polls"])} polls`;
		}
		default: {
			return `${stage} ${event} ${String(detail["message"])}`;
		}
	}
}

function printSummary(summary: RunSummary, paths: { evidence: string; privateLog: string }): void {
	console.log("\n========== SUMMARY ==========");
	console.log(`run id: ${summary.runId}`);
	console.log(`place version: ${summary.placeVersionId ?? "(unresolved)"}`);
	for (const stage of summary.stages) {
		console.log(
			`${stage.kind.padEnd(9)} ${stage.verdict.padEnd(27)} polls=${stage.polls.toString().padStart(2)} ` +
				`state=${stage.observation.finalState ?? "-"} started=${String(stage.observation.startedSeen)} ` +
				`sha256=${stage.sha256.slice(0, 12)}`,
		);
	}

	console.log(
		`tasks submitted: ${summary.stages
			.filter((stage) => stage.observation.submitted)
			.length.toString()}`,
	);
	console.log(`colour: ${summary.colour}`);
	console.log(`private artifact: ${paths.privateLog}`);
	console.log(`redacted artifact: ${paths.evidence}`);
	console.log("=============================");
}

async function sleepAsync(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function makeDeps(privateLog: string, records: Array<ProbeRecord>): ProbeDeps {
	return {
		emit: (record) => {
			records.push(record);
			appendFileSync(privateLog, toJsonl([record]));
			console.log(`${record.at} ${describeRecord(record)}`);
		},
		fetch: async (url, init) => fetch(url, init),
		now: () => new Date(),
		sleepAsync,
	};
}

async function mainAsync(): Promise<void> {
	const resolved = resolveProbeConfig(process.env);
	if (!resolved.ok) {
		console.error(resolved.reason);
		process.exit(1);
	}

	const runId = `${Date.now().toString(RADIX_36)}-${randomUUID().slice(0, RUN_SUFFIX_LENGTH)}`;
	mkdirSync(PRIVATE_DIRECTORY, { recursive: true });
	mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
	const privateLog = `${PRIVATE_DIRECTORY}${runId}.private.jsonl`;
	const evidence = `${EVIDENCE_DIRECTORY}${runId}.jsonl`;
	const records: Array<ProbeRecord> = [];

	console.log(
		`run ${runId}: place ${resolved.config.placeId}, timeout ${resolved.config.timeoutSeconds.toString()}s`,
	);
	const summary = await runProbeAsync({
		config: resolved.config,
		deps: makeDeps(privateLog, records),
		runId,
	});

	writeFileSync(evidence, toJsonl(records.map((record) => redactRecord(record))));
	printSummary(summary, { evidence, privateLog });
}

await mainAsync();
