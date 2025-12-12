import CoverageReport from "monocart-coverage-reports";
import { glob } from "node:fs/promises";
import process from "node:process";

async function mergeCoverage(): Promise<void> {
	/** Find all coverage directories in packages and apps. */
	const coverageDirectories: Array<string> = [];

	for await (const directory of glob("{packages,apps}/*/coverage")) {
		coverageDirectories.push(`./${directory}`);
	}

	if (coverageDirectories.length === 0) {
		console.log("No coverage directories found");
		process.exit(0);
	}

	console.log("Merging coverage from:", coverageDirectories);

	const report = CoverageReport({
		inputDir: coverageDirectories,
		outputDir: "./coverage",
		reports: [
			["v8", { outputFile: "v8-coverage.json" }],
			["console-details"],
			["html"],
			["lcov"],
			["json", { file: "coverage-final.json" }],
		],
		/**
		 * Normalize paths across packages.
		 *
		 * @param filePath - The absolute file path from coverage data.
		 * @returns The relative path from the bedrock root.
		 */
		sourcePath: (filePath: string): string => filePath.replace(/^.*\/bedrock\//, ""),
	});

	await report.generate();
	console.log("Coverage reports merged to ./coverage");
}

mergeCoverage().catch((err) => {
	console.error("Failed to merge coverage:", err);
	process.exit(1);
});
