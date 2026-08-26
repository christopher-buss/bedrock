import { GameId } from "shared/assets/resources";

// Development-only. `production.project.json` does not mount this tree, which
// is the whole reason the build step is handed the environment.
print(`running in the ${GameId[game.GameId as GameId] ?? "unknown"} universe`);
