import { parseJSON, parseYAML } from "confbox";
import { join, relative } from "node:path";

import { type Manifest, type Snapshot, versionedNames } from "./index.ts";

/** Read-only operations used by the unprivileged gate. */
export interface GateLocalPort {
	/** Executes pnpm with arguments, without shell interpolation. */
	command: (binary: string, args: Array<string>) => string;
	/** Reads a local text file. */
	read: (path: string) => string;
	/** Workspace root, excluded from release scope. */
	root: string;
}

/**
 * Derive native pnpm release scope from the selected workspace's manifests.
 * @param port - Read-only local operations.
 * @returns Sorted versioned package names.
 */
export function readGateScope(port: GateLocalPort): Array<string> {
	const listed = parseJSON<Array<{ path: string }>>(
		port.command("pnpm", ["list", "-r", "--depth", "-1", "--json"]),
	);
	const packages = Object.fromEntries(
		listed.map((entry) => [
			relative(port.root, entry.path) || ".",
			parseJSON<Manifest>(port.read(join(entry.path, "package.json"))),
		]),
	);
	const workspace = parseYAML<Snapshot["workspace"]>(port.read("pnpm-workspace.yaml"));
	return versionedNames({ packages, workspace });
}

/**
 * Ask pnpm for changed consumers at exactly the checkout's base parent.
 * @param port - Read-only local operations.
 * @param options - Verified immutable base SHA and native versioned names.
 * @returns Selected versioned consumer names.
 */
export function readGateSelection(
	port: GateLocalPort,
	options: { base: string; scope: Array<string> },
): Array<string> {
	const selected = parseJSON<Array<{ name: string }>>(
		port.command("pnpm", [
			"list",
			"-r",
			"--depth",
			"-1",
			"--json",
			"--filter",
			`[${options.base}]`,
		]),
	);
	return selected.map((entry) => entry.name).filter((name) => options.scope.includes(name));
}
