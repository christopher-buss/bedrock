// Stands in for a user-authored `.bedrock/deploy.ts` override. Records the
// forwarded flags, the BEDROCK_CLI env signal, and its own script basename to
// a cwd-relative file so the e2e test can prove the real CLI discovered and
// executed it with the documented spawn protocol. The stdout line proves the
// override's output flows through the CLI's inherited stdio.
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";

writeFileSync(
	"override-ran.json",
	JSON.stringify({
		cli: process.env["BEDROCK_CLI"],
		flags: process.argv.slice(2),
		script: basename(process.argv[1] ?? ""),
	}),
);

process.stdout.write("bedrock override deploy ran\n");
process.exit(0);
