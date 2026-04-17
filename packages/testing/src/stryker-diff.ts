/**
 * A contiguous range of modified lines within a file.
 */
export interface Hunk {
	/** Last line in the modified range (inclusive, 1-indexed). */
	endLine: number;
	/** First line in the modified range (inclusive, 1-indexed). */
	startLine: number;
}

/**
 * Changes observed within a single file in the current `git diff HEAD`.
 */
export interface FileChange {
	/** Per-hunk line ranges touched in this file. */
	hunks: Array<Hunk>;
	/** Repo-relative path to the file. */
	path: string;
}

/**
 * A file change the wrapper cannot translate into a mutation range:
 * renames, new files, and binary blobs. Surfaced as hard errors.
 */
export type DiffReject =
	| { from: string; kind: "rename"; to: string }
	| { kind: "binary"; path: string }
	| { kind: "new-file"; path: string };

/**
 * Outcome of parsing `git diff HEAD`: either the per-file change set or
 * a list of reject reasons that prevent safe mutation scoping.
 */
export type DiffResult =
	| { files: Array<FileChange>; kind: "changes" }
	| { kind: "reject"; reasons: Array<DiffReject> };

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const RENAME_FROM = /^rename from (.+)$/;
const RENAME_TO = /^rename to (.+)$/;
const NEW_FILE_MARKER = /^new file mode /;
const BINARY_MARKER = /^Binary files /;

interface ParseState {
	current: FileChange | undefined;
	files: Array<FileChange>;
	rejects: Array<DiffReject>;
	renameFrom: string | undefined;
}

type LineHandler = (line: string, state: ParseState) => boolean;

/**
 * Parse a unified-diff string (as produced by `git diff --unified=0 HEAD`)
 * into a per-file set of touched line ranges.
 *
 * @param raw - Unified diff text.
 * @returns Parsed per-file changes.
 */
export function parseDiff(raw: string): DiffResult {
	const state: ParseState = { current: undefined, files: [], rejects: [], renameFrom: undefined };

	for (const line of raw.split("\n")) {
		handleDiffLine(line, state);
	}

	if (state.rejects.length > 0) {
		return { kind: "reject", reasons: state.rejects };
	}

	return { files: state.files, kind: "changes" };
}

/**
 * Construct the Stryker CLI arguments for restricting mutation to the
 * given file changes. Returns an empty array when no files are affected.
 *
 * @param files - Parsed file changes from {@link parseDiff}.
 * @returns Stryker CLI args, e.g. `["--mutate", "a.ts:1-5,b.ts:3-3"]`.
 */
export function buildMutateArgs(files: ReadonlyArray<FileChange>): Array<string> {
	if (files.length === 0) {
		return [];
	}

	const patterns = files.flatMap((file) => {
		return file.hunks.map((hunk) => `${file.path}:${hunk.startLine}-${hunk.endLine}`);
	});
	return ["--mutate", patterns.join(",")];
}

const NON_MUTABLE_SUFFIXES: ReadonlyArray<string> = [".spec.ts", ".test.ts", ".d.ts"];

/**
 * Filter out files that Stryker should never mutate: test files and type
 * declarations. Used to clean up a `parseDiff` result before passing it to
 * `buildMutateArgs`, since the CLI `--mutate` flag overrides the config's
 * own ignore patterns.
 *
 * @param files - Changes as returned by {@link parseDiff}.
 * @returns The subset whose paths point at production source files.
 */
export function filterMutableFiles(files: ReadonlyArray<FileChange>): Array<FileChange> {
	return files.filter(
		(file) => !NON_MUTABLE_SUFFIXES.some((suffix) => file.path.endsWith(suffix)),
	);
}

/**
 * Bucket file changes by the workspace package that contains them. Paths
 * in the returned buckets are rewritten to be relative to their package
 * directory so they can be passed to a per-package `stryker run` invocation.
 * Files that don't live under any known package are dropped.
 *
 * @param files - Changes across the whole repo.
 * @param packageDirectories - Repo-relative package directories (e.g. `packages/open-cloud`).
 * @returns Map of package directory to changes with package-relative paths.
 */
export function groupByPackage(
	files: ReadonlyArray<FileChange>,
	packageDirectories: ReadonlyArray<string>,
): Map<string, Array<FileChange>> {
	const grouped = new Map<string, Array<FileChange>>();

	for (const file of files) {
		const packageDirectory = packageDirectories.find((directory) => {
			return file.path.startsWith(`${directory}/`);
		});
		if (packageDirectory === undefined) {
			continue;
		}

		const relativePath = file.path.slice(packageDirectory.length + 1);
		const bucket = grouped.get(packageDirectory) ?? [];
		bucket.push({ hunks: file.hunks, path: relativePath });
		grouped.set(packageDirectory, bucket);
	}

	return grouped;
}

const HANDLERS: ReadonlyArray<LineHandler> = [
	handleFileHeader,
	handleNewFile,
	handleBinary,
	handleRenameFrom,
	handleRenameTo,
	handleHunk,
];

function handleDiffLine(line: string, state: ParseState): void {
	for (const handler of HANDLERS) {
		if (handler(line, state)) {
			return;
		}
	}
}

function handleFileHeader(line: string, state: ParseState): boolean {
	const match = DIFF_HEADER.exec(line);
	if (match?.[2] === undefined) {
		return false;
	}

	state.current = { hunks: [], path: match[2] };
	state.files.push(state.current);
	state.renameFrom = undefined;
	return true;
}

function handleNewFile(line: string, state: ParseState): boolean {
	if (!NEW_FILE_MARKER.test(line) || !state.current) {
		return false;
	}

	state.rejects.push({ kind: "new-file", path: state.current.path });
	state.files.pop();
	state.current = undefined;
	return true;
}

function handleBinary(line: string, state: ParseState): boolean {
	if (!BINARY_MARKER.test(line) || !state.current) {
		return false;
	}

	state.rejects.push({ kind: "binary", path: state.current.path });
	state.files.pop();
	state.current = undefined;
	return true;
}

function handleRenameFrom(line: string, state: ParseState): boolean {
	const match = RENAME_FROM.exec(line);
	if (match?.[1] === undefined) {
		return false;
	}

	state.renameFrom = match[1];
	state.files.pop();
	state.current = undefined;
	return true;
}

function handleRenameTo(line: string, state: ParseState): boolean {
	const match = RENAME_TO.exec(line);
	if (match?.[1] === undefined || state.renameFrom === undefined) {
		return false;
	}

	state.rejects.push({ from: state.renameFrom, kind: "rename", to: match[1] });
	state.renameFrom = undefined;
	return true;
}

function handleHunk(line: string, state: ParseState): boolean {
	const match = HUNK_HEADER.exec(line);
	if (!match || !state.current) {
		return false;
	}

	const startLine = Number(match[1]);
	const count = match[2] === undefined ? 1 : Number(match[2]);
	state.current.hunks.push({ endLine: startLine + count - 1, startLine });
	return true;
}
