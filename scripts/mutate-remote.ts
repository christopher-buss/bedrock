import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const SSH_PROBE_OPTS = ["-o", "ConnectTimeout=2", "-o", "BatchMode=yes"];

const RSYNC_EXCLUDES = [
	"--exclude=node_modules",
	"--exclude=.stryker-tmp",
	"--exclude=dist",
	"--exclude=reports",
	"--exclude=.cache",
	"--exclude=.turbo",
];

interface RemoteConfig {
	container: string;
	host: string;
	stage: string;
	worktree: string;
}

function readConfig(): RemoteConfig | undefined {
	const host = process.env["BEDROCK_REMOTE_MUTATE_HOST"];
	if (host === undefined || host === "") {
		return undefined;
	}

	return {
		container: process.env["BEDROCK_REMOTE_MUTATE_CONTAINER"] ?? "bedrock-mutate-server",
		host,
		stage: process.env["BEDROCK_REMOTE_MUTATE_STAGE"] ?? "~/bedrock-stage",
		worktree: path.basename(process.cwd()),
	};
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
	const result = spawnSync("rsync", ["-az", "--delete", ...RSYNC_EXCLUDES, "./", remote], {
		stdio: "inherit",
	});
	return result.status ?? 1;
}

function rsyncReportsDown(config: RemoteConfig): number {
	const remote = `${config.host}:${config.stage}/${config.worktree}/`;
	const result = spawnSync(
		"rsync",
		[
			"-az",
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

function execMutate(config: RemoteConfig): number {
	const baseRef = process.env["MUTATE_BASE_REF"];
	const baseEnvironment =
		baseRef !== undefined && baseRef !== "" ? `MUTATE_BASE_REF=${baseRef} ` : "";
	const remoteScript = [
		`cd /data/worktrees/${config.worktree}`,
		"pnpm install --frozen-lockfile --store-dir=/data/pnpm-store",
		`${baseEnvironment}pnpm mutate:changed`,
	].join(" && ");

	const result = spawnSync(
		"ssh",
		["-t", config.host, "docker", "exec", "-i", config.container, "bash", "-lc", remoteScript],
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

	const upStatus = rsyncUp(config);
	if (upStatus !== 0) {
		console.error(`rsync to ${config.host} failed; aborting offload`);
		return upStatus;
	}

	const execStatus = execMutate(config);
	rsyncReportsDown(config);
	return execStatus;
}

process.exit(main());
