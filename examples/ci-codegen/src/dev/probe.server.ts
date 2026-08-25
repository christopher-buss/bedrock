import { GameId } from "shared/assets/resources";

// Development-only: the production Rojo project does not include this tree.
print(`running in the ${GameId[game.GameId as GameId] ?? "unknown"} universe`);
