import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, vi } from "vitest";

/** JSON payload the `echo-protocol.ts` override fixture writes to disk. */
export interface ProbePayload {
	/** `BEDROCK_API_KEY` value the override observed, if set. */
	readonly apiKey?: string;
	/** Argv the override received, excluding the runtime executable. */
	readonly args: ReadonlyArray<string>;
	/** `BEDROCK_CLI` value the override observed, if set. */
	readonly cli?: string;
	/** `BEDROCK_GITHUB_TOKEN` value the override observed, if set. */
	readonly githubToken?: string;
}

/**
 * Point `OVERRIDE_PROBE_OUTPUT` at a fresh temp file so a spawned override
 * fixture can record what it observed. Env-stub removal and temp-dir cleanup
 * are registered via `onTestFinished`.
 * @returns A reader for the payload the spawned override wrote.
 */
export function withProbe(): () => ProbePayload {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-override-probe-"));
	const file = join(directory, "probe.json");
	vi.stubEnv("OVERRIDE_PROBE_OUTPUT", file);
	onTestFinished(() => {
		vi.unstubAllEnvs();
		rmSync(directory, { force: true, recursive: true });
	});
	return () => JSON.parse(readFileSync(file, "utf8")) as unknown as ProbePayload;
}
