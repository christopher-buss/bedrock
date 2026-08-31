import type { ResourceDesiredInput } from "./flatten.ts";

/**
 * Whether a resource is produced by the project's build step and must
 * therefore be reconciled after it, in the publish stage.
 *
 * Only a place that declares a `filePath` qualifies: its `.rbxl` is the
 * artifact `build.ts` (re)writes on every deploy. A config-only place
 * declares no file, so nothing builds it and it reconciles in the asset
 * stage alongside passes, products, and the universe. Game-pass and
 * developer-product icons are authored assets, not build output, so they
 * never qualify either.
 *
 * The provision and publish stages both route through this one predicate so
 * they cannot disagree about which resources each stage owns.
 *
 * @param input - A flattened resource input from `flattenConfig`.
 * @returns `true` when the resource must wait for the build step.
 */
export function needsArtifact(input: ResourceDesiredInput): boolean {
	return input.kind === "place" && input.filePath !== undefined;
}
