#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

/**
 * Fails when a tracked symlink points at a path that does not exist.
 *
 * The GitHub Actions runner unpacks an action repository by extracting the
 * whole repo tarball and resolving every symlink it contains, so one dangling
 * link anywhere in the tree aborts `Download action repository` for every
 * consumer of `christopher-buss/bedrock/packages/actions/*`.
 */

const SYMLINK_MODE = "120000";

const entries = execFileSync("git", ["ls-files", "-s", "-z"], {
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean);

const dangling = entries
	.filter((entry) => entry.startsWith(SYMLINK_MODE))
	.map((entry) => entry.slice(entry.indexOf("\t") + 1))
	.filter((path) => !existsSync(path));

if (dangling.length > 0) {
	console.error("Dangling tracked symlinks:");
	for (const path of dangling) {
		console.error(`  ${path}`);
	}

	process.exit(1);
}
