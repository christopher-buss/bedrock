import type { MigrationReportFile } from "./migration-report.ts";

/**
 * Serialize a {@link MigrationReportFile} as the bytes written to
 * `.bedrock/migration-report.json`. The output is canonical JSON: pretty-
 * printed with two-space indentation, terminated with a trailing newline.
 *
 * @param file - The summary plus warnings to serialize.
 * @returns A UTF-8 source string ending with a trailing newline.
 */
export function serializeMigrationReport(file: MigrationReportFile): string {
	return `${JSON.stringify(file, undefined, 2)}\n`;
}
