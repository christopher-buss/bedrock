import { generateTests } from "generate-jsdoc-example-tests";
import { glob } from "node:fs/promises";
import process from "node:process";

async function main(): Promise<void> {
	const sourceDirectories: Array<string> = [];

	for await (const directory of glob("{packages,apps}/*/src")) {
		sourceDirectories.push(`./${directory}`);
	}

	if (sourceDirectories.length === 0) {
		console.log("No source directories found");
		process.exit(0);
	}

	console.log("Generating example tests from:", sourceDirectories);

	await generateTests(sourceDirectories, {
		headers: ['import { expect, it } from "vitest";'],
		testFileExtension: ".example.spec",
		testFunctionName: "it",
	});

	console.log("Example tests generated");
}

main().catch((err) => {
	console.error("Failed to generate example tests:", err);
	process.exit(1);
});
