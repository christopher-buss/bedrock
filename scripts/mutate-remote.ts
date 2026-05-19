/**
 * Offloads `pnpm mutate:changed` to a remote host over SSH. Invoked by
 * the dispatch hook in `mutate-changed.ts` when
 * `BEDROCK_REMOTE_MUTATE_HOST` is set; absent that env var, mutation
 * runs in process and this script is never spawned.
 *
 * Per invocation: probe a long-running Docker container on the host,
 * rsync the working tree to a per-worktree staging dir, stream the
 * pre-computed git diff into the container via tee, run the mutation
 * inside the container, and rsync `packages/*\/reports/` back. Falls
 * back to the in-process mutation script if the probe fails so a
 * sleeping host never blocks a commit hook. Each local worktree maps
 * to its own remote staging dir (basename of cwd), so concurrent
 * agents on the same host don't clobber each other.
 *
 * If the container is running but its bind mount has gone stale
 * (Docker Desktop's WSL share commonly detaches after Docker Desktop
 * restarts), the runner attempts `docker restart` once to re-establish
 * the mount. It first checks for an in-flight mutation on the shared
 * container and refuses to restart when one is detected so a
 * concurrent worktree's run isn't clobbered.
 *
 * The diff is computed locally and shipped as a file because git
 * worktrees use a `.git` file pointing at a path that only exists on
 * the local machine; the remote does not need a working `.git`.
 *
 * Configuration env vars (typically set in `~/.zshenv` so
 * non-interactive shells like hk inherit them):
 *
 * - `BEDROCK_REMOTE_MUTATE_HOST`: SSH target. Required to enable
 *   offload.
 * - `BEDROCK_REMOTE_MUTATE_STAGE`: base directory on the remote.
 *   Defaults to `~/bedrock-stage`. Must be an absolute path when
 *   `BEDROCK_REMOTE_MUTATE_RSYNC_PATH` is set, since the alternate
 *   rsync path runs outside a POSIX shell and will not expand `~`.
 * - `BEDROCK_REMOTE_MUTATE_CONTAINER`: container name. Defaults to
 *   `bedrock-mutate-server`.
 * - `BEDROCK_REMOTE_MUTATE_RSYNC_PATH`: passed to `rsync --rsync-path`
 *   when the remote SSH default shell does not reach rsync directly.
 *   For a Windows host whose sshd uses `cmd.exe` but whose stage path
 *   lives in WSL2, use `"wsl rsync"`.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const SSH_OPTS = ["-o", "ConnectTimeout=2", "-o", "BatchMode=yes"];
const RSYNC_RSH = `ssh ${SSH_OPTS.join(" ")}`;
const SAFE_WORKTREE_NAME = /^[A-Za-z0-9._-]+$/;

const RSYNC_EXCLUDES = [
	"--exclude=.git",
	"--exclude=node_modules",
	"--exclude=.stryker-tmp",
	"--exclude=reports",
	"--exclude=.cache",
	"--exclude=.turbo",
];

const REMOTE_DIFF_PATH = ".bedrock-diff.patch";
const REMOTE_SCRIPT_PATH = ".bedrock-mutate.sh";

interface RemoteConfig {
	container: string;
	host: string;
	rsyncPath: string | undefined;
	stage: string;
	worktree: string;
}

function readConfig(): RemoteConfig | undefined {
	const host = process.env["BEDROCK_REMOTE_MUTATE_HOST"];
	if (host === undefined || host === "") {
		return undefined;
	}

	const rsyncPath = process.env["BEDROCK_REMOTE_MUTATE_RSYNC_PATH"];
	const worktree = path.basename(process.cwd());
	if (!SAFE_WORKTREE_NAME.test(worktree)) {
		throw new Error(
			`worktree name ${JSON.stringify(worktree)} contains characters unsafe for shell interpolation; offload requires [A-Za-z0-9._-]`,
		);
	}

	return {
		container: process.env["BEDROCK_REMOTE_MUTATE_CONTAINER"] ?? "bedrock-mutate-server",
		host,
		rsyncPath: rsyncPath !== undefined && rsyncPath !== "" ? rsyncPath : undefined,
		stage: process.env["BEDROCK_REMOTE_MUTATE_STAGE"] ?? "~/bedrock-stage",
		worktree,
	};
}

function rsyncPathArgument(config: RemoteConfig): Array<string> {
	return config.rsyncPath === undefined ? [] : [`--rsync-path=${config.rsyncPath}`];
}

function computeDiff(): string {
	const baseRef = process.env["MUTATE_BASE_REF"];
	const diffTarget = baseRef === undefined || baseRef === "" ? "HEAD" : `${baseRef}...HEAD`;
	const result = spawnSync("git", ["diff", "--unified=0", diffTarget], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`git diff failed with status ${String(result.status)}: ${result.stderr}`);
	}

	return result.stdout;
}

function writeFileToContainer(
	config: RemoteConfig,
	contents: string,
	relativePath: string,
): number {
	const result = spawnSync(
		"ssh",
		[
			...SSH_OPTS,
			config.host,
			"docker",
			"exec",
			"-i",
			config.container,
			"tee",
			`/data/worktrees/${config.worktree}/${relativePath}`,
		],
		{ input: contents, stdio: ["pipe", "ignore", "inherit"] },
	);
	return result.status ?? 1;
}

function probe(config: RemoteConfig): boolean {
	const result = spawnSync(
		"ssh",
		[
			...SSH_OPTS,
			config.host,
			"docker",
			"inspect",
			"-f",
			"{{.State.Running}}",
			config.container,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	return result.status === 0 && result.stdout.trim() === "true";
}

function rsyncUp(config: RemoteConfig): number {
	const remote = `${config.host}:${config.stage}/${config.worktree}/`;
	const result = spawnSync(
		"rsync",
		[
			"-az",
			"-e",
			RSYNC_RSH,
			"--delete",
			...rsyncPathArgument(config),
			...RSYNC_EXCLUDES,
			"./",
			remote,
		],
		{ stdio: "inherit" },
	);
	return result.status ?? 1;
}

function rsyncReportsDown(config: RemoteConfig): void {
	const remote = `${config.host}:${config.stage}/${config.worktree}/`;
	const result = spawnSync(
		"rsync",
		[
			"-az",
			"-e",
			RSYNC_RSH,
			...rsyncPathArgument(config),
			"--include=packages/",
			"--include=packages/*/",
			"--include=packages/*/reports/",
			"--include=packages/*/reports/**",
			"--exclude=*",
			remote,
			"./",
		],
		{ stdio: "inherit" },
	);
	if ((result.status ?? 1) !== 0) {
		console.warn(
			`note: failed to sync reports back from ${config.host}; local reports may be stale`,
		);
	}
}

function buildRemoteScript(config: RemoteConfig): string {
	return [
		"#!/usr/bin/env bash",
		"set -eu",
		`cd /data/worktrees/${config.worktree}`,
		"pnpm install --frozen-lockfile --store-dir=/data/pnpm-store",
		`BEDROCK_DIFF_INPUT_FILE=${REMOTE_DIFF_PATH} pnpm mutate:changed`,
		"",
	].join("\n");
}

function execMutate(config: RemoteConfig): number {
	const writeStatus = writeFileToContainer(config, buildRemoteScript(config), REMOTE_SCRIPT_PATH);
	if (writeStatus !== 0) {
		console.error(`failed to write run script to ${config.container}`);
		return writeStatus;
	}

	const result = spawnSync(
		"ssh",
		[
			...SSH_OPTS,
			config.host,
			"docker",
			"exec",
			"-i",
			config.container,
			"bash",
			`/data/worktrees/${config.worktree}/${REMOTE_SCRIPT_PATH}`,
		],
		{ stdio: "inherit" },
	);
	return result.status ?? 1;
}

function runLocal(): number {
	const environment = { ...process.env };
	delete environment["BEDROCK_REMOTE_MUTATE_HOST"];
	const result = spawnSync("bun", ["scripts/mutate-changed.ts"], {
		env: environment,
		stdio: "inherit",
	});
	return result.status ?? 1;
}

function containerSeesWorktree(config: RemoteConfig): boolean {
	const result = spawnSync(
		"ssh",
		[
			...SSH_OPTS,
			config.host,
			"docker",
			"exec",
			config.container,
			"test",
			"-d",
			`/data/worktrees/${config.worktree}`,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
	return result.status === 0;
}

function containerHasActiveMutation(config: RemoteConfig): boolean {
	const result = spawnSync(
		"ssh",
		[
			...SSH_OPTS,
			config.host,
			"docker",
			"exec",
			config.container,
			"pgrep",
			"-f",
			"bedrock-mutate.sh|stryker",
		],
		{ stdio: ["ignore", "ignore", "ignore"] },
	);
	// pgrep exits 1 when nothing matches. Treat any other non-zero
	// status (2 syntax, 3 fatal, 127 missing binary) as "active" so
	// we never restart on uncertainty.
	return result.status !== 1;
}

function restartContainer(config: RemoteConfig): boolean {
	const result = spawnSync(
		"ssh",
		[...SSH_OPTS, config.host, "docker", "restart", config.container],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
	return result.status === 0;
}

function recoverBindMount(config: RemoteConfig): string | undefined {
	if (containerHasActiveMutation(config)) {
		return (
			`${config.container} cannot see /data/worktrees/${config.worktree} after rsync, ` +
			"but another mutation is in progress on the shared container; refusing to " +
			"docker restart and clobber it. Retry once the other run finishes, or restart " +
			`${config.container} by hand if you know the bind mount is stale.`
		);
	}

	if (!restartContainer(config)) {
		return (
			`${config.container} cannot see /data/worktrees/${config.worktree} after rsync ` +
			`and docker restart ${config.container} failed; run docker rm -f ${config.container} ` +
			`and re-create with -v ${config.stage}:/data/worktrees to re-establish the WSL share.`
		);
	}

	if (!containerSeesWorktree(config)) {
		return (
			`${config.container} still cannot see /data/worktrees/${config.worktree} after ` +
			"docker restart; bind mount is severely detached. Run docker rm -f " +
			`${config.container} and re-create with -v ${config.stage}:/data/worktrees.`
		);
	}

	return undefined;
}

function setupRemote(config: RemoteConfig): string | undefined {
	const upStatus = rsyncUp(config);
	if (upStatus !== 0) {
		return `rsync to ${config.host} failed (status ${String(upStatus)})`;
	}

	if (!containerSeesWorktree(config)) {
		const recoveryFailure = recoverBindMount(config);
		if (recoveryFailure !== undefined) {
			return recoveryFailure;
		}
	}

	const diff = computeDiff();
	const diffStatus = writeFileToContainer(config, diff, REMOTE_DIFF_PATH);
	if (diffStatus !== 0) {
		return `writing diff to ${config.container} failed (status ${String(diffStatus)})`;
	}

	return undefined;
}

function reportLoudFailure(reason: string): void {
	const banner = "=".repeat(64);
	process.stderr.write(
		`\n${banner}\nREMOTE MUTATION OFFLOAD FAILED; running mutation locally\n` +
			`${banner}\n${reason}\n${banner}\n\n`,
	);
}

function reportLoudFailureTrailer(reason: string): void {
	process.stderr.write(`\n[remote offload was unavailable for this run: ${reason}]\n\n`);
}

function main(): number {
	const config = readConfig();
	if (config === undefined) {
		return runLocal();
	}

	if (!probe(config)) {
		console.warn(
			`note: ${config.container} not reachable on ${config.host}; running mutation locally`,
		);
		return runLocal();
	}

	const failure = setupRemote(config);
	if (failure !== undefined) {
		reportLoudFailure(failure);
		const status = runLocal();
		reportLoudFailureTrailer(failure);
		return status;
	}

	const execStatus = execMutate(config);
	rsyncReportsDown(config);
	return execStatus;
}

process.exit(main());
