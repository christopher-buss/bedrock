// Bun-runnable fixture for the spawn-override integration test. Exits 3 so
// the dispatcher reports Err(nonZeroExit, 3) end-to-end.
import process from "node:process";

process.exit(3);
