// Bun-runnable fixture for the spawn-override integration test. Writes the
// argv and selected env vars it observed to OVERRIDE_PROBE_OUTPUT so the
// test can assert the dispatcher's protocol end-to-end.
import { writeFileSync } from "node:fs";
import process from "node:process";

function main(): void {
	const outPath = process.env["OVERRIDE_PROBE_OUTPUT"];
	if (outPath === undefined) {
		console.error("OVERRIDE_PROBE_OUTPUT env not set");
		process.exit(2);
	}

	const payload = {
		apiKey: process.env["BEDROCK_API_KEY"],
		args: process.argv.slice(1),
		cli: process.env["BEDROCK_CLI"],
		githubToken: process.env["GITHUB_TOKEN"],
	};

	writeFileSync(outPath, JSON.stringify(payload));
	process.exit(0);
}

main();
