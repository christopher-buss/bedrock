import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const SSH_PROBE_OPTS = ["-o", "ConnectTimeout=2", "-o", "BatchMode=yes"];

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
	return {
		container: process.env["BEDROCK_REMOTE_MUTATE_CONTAINER"] ?? "bedrock-mutate-server",
		host,
		rsyncPath: rsyncPath !== undefined && rsyncPath !== "" ? rsyncPath : undefined,
		stage: process.env["BEDROCK_REMOTE_MUTATE_STAGE"] ?? "~/bedrock-stage",
		worktree: path.basename(process.cwd()),
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
			...SSH_PROBE_OPTS,
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
		["-az", "--delete", ...rsyncPathArgument(config), ...RSYNC_EXCLUDES, "./", remote],
		{ stdio: "inherit" },
	);
	return result.status ?? 1;
}

function rsyncReportsDown(config: RemoteConfig): number {
	const remote = `${config.host}:${config.stage}/${config.worktree}/`;
	const result = spawnSync(
		"rsync",
		[
			"-az",
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
	return result.status ?? 1;
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
			"-t",
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

	const diff = computeDiff();

	const upStatus = rsyncUp(config);
	if (upStatus !== 0) {
		console.error(`rsync to ${config.host} failed; aborting offload`);
		return upStatus;
	}

	const diffStatus = writeFileToContainer(config, diff, REMOTE_DIFF_PATH);
	if (diffStatus !== 0) {
		console.error(`failed to write diff to ${config.container}; aborting offload`);
		return diffStatus;
	}

	const execStatus = execMutate(config);
	rsyncReportsDown(config);
	return execStatus;
}

process.exit(main());
