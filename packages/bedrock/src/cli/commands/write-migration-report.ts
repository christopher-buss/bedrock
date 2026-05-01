import type { Result } from "@bedrock/ocale";

import { dirname, join } from "node:path";

import type { MigrationReport } from "../../core/migrate/migration-report.ts";
import { renderMigrationReportMarkdown } from "../../core/migrate/render-migration-report-md.ts";
import { serializeMigrationReport } from "../../core/migrate/serialize-migration-report.ts";
import type { ClackPort } from "../render.ts";
import { describeUnknown } from "./describe-unknown.ts";

const REPORT_DIR_NAME = ".bedrock";
const JSON_FILE_NAME = "migration-report.json";
const MD_FILE_NAME = "migration-report.md";

/** Paths the writer produced. The Markdown path is reported to the user. */
interface MigrationReportPaths {
	/** Path to `.bedrock/migration-report.json`. */
	readonly jsonPath: string;
	/** Path to `.bedrock/migration-report.md`. */
	readonly mdPath: string;
}

/** Subset of the migrate command's deps the report writer touches. */
interface WriterDeps {
	readonly clack: ClackPort;
	readonly mkdir: (path: string) => Promise<void>;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface WriteInputs {
	readonly deps: WriterDeps;
	readonly report: MigrationReport;
	readonly stateFilePath: string;
}

/**
 * Persist the migration report as `.bedrock/migration-report.json` and a
 * pure derivation `.bedrock/migration-report.md` next to the per-environment
 * state files. Always written so the user can compare runs even when no
 * warnings were emitted; the CLI summary line that points at the Markdown
 * file is gated on warning count separately.
 *
 * @param input - Resolved deps, the migration report, and the path of the
 *   Mantle state file the report describes.
 * @returns `Ok` with both file paths once both writes succeed; `Err` on the
 *   first failure (already rendered to clack).
 */
export async function writeMigrationReport(
	input: WriteInputs,
): Promise<Result<MigrationReportPaths, void>> {
	const { deps, report, stateFilePath } = input;
	const reportDirectory = join(dirname(stateFilePath), REPORT_DIR_NAME);
	const jsonPath = join(reportDirectory, JSON_FILE_NAME);
	const mdPath = join(reportDirectory, MD_FILE_NAME);
	const file = { summary: report.summary, warnings: report.warnings };

	try {
		await deps.mkdir(reportDirectory);
	} catch (err) {
		deps.clack.logError(
			`migration report directory create failed (${reportDirectory}): ${describeUnknown(err)}`,
		);
		return { err: undefined, success: false };
	}

	try {
		await deps.writeFile(jsonPath, serializeMigrationReport(file));
	} catch (err) {
		deps.clack.logError(`migration report write failed (${jsonPath}): ${describeUnknown(err)}`);
		return { err: undefined, success: false };
	}

	try {
		await deps.writeFile(mdPath, renderMigrationReportMarkdown(file));
	} catch (err) {
		deps.clack.logError(`migration report write failed (${mdPath}): ${describeUnknown(err)}`);
		return { err: undefined, success: false };
	}

	return { data: { jsonPath, mdPath }, success: true };
}
