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
