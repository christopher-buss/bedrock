import { GameId } from "shared/assets/resources";

// `production.project.json` does not mount this tree.
print(`running in the ${GameId[game.GameId as GameId] ?? "unknown"} universe`);
