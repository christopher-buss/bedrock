// The `@since` vocabulary shared by the public-API coverage guards and the
// release-time resolver.

/** Stands in for a version that the release plan has not yet decided. */
export const UNRELEASED_SINCE = "unreleased";

// The triple is captured alone so a prerelease or build suffix is validated
// but excluded from ordering: `0.1.5-beta.1` documents the same release.
const VERSION = /^(\d+\.\d+\.\d+)(?:-[\dA-Za-z.-]+)?(?:\+[\dA-Za-z.-]+)?$/;

// Zero-padding to a fixed width keeps versions lexically comparable.
const COMPONENT_WIDTH = 10;

const TEST_MODULE = /\.(?:spec|spec-d|test)\.ts$/;

const UNRESOLVED_SINCE_TAG = new RegExp(
	String.raw`(?<=@since[ \t]+)${UNRELEASED_SINCE}(?![-\w])`,
	"gu",
);

/**
 * Whether a `@since` tag is acceptable on a package sitting at
 * `currentVersion`. A tag naming a future version is a guess about a release
 * plan that has not been assembled yet.
 *
 * @param tag - The declaration's `@since` value, or `undefined` when untagged.
 * @param currentVersion - The package's version as published today.
 * @returns `true` when the tag may stand as written.
 */
export function isValidSinceTag(tag: string | undefined, currentVersion: string): boolean {
	if (tag === UNRELEASED_SINCE) {
		return true;
	}

	if (tag === undefined) {
		return false;
	}

	const tagOrder = comparableVersion(tag);
	const currentOrder = comparableVersion(currentVersion);
	if (tagOrder === undefined || currentOrder === undefined) {
		return false;
	}

	return tagOrder <= currentOrder;
}

/**
 * Rewrite every unresolved placeholder in a module to the version being
 * released, leaving already-versioned tags alone.
 *
 * @param source - Module text to rewrite.
 * @param version - Version the pending symbols are shipping in.
 * @returns The module text with each placeholder replaced.
 */
export function resolveUnreleasedSinceTags(source: string, version: string): string {
	return source.replaceAll(UNRESOLVED_SINCE_TAG, () => version);
}

/**
 * Whether a module should have its placeholders resolved. Tests declare no
 * public API, and one pinning the placeholder holds it as a fixture string.
 *
 * @param relativePath - Module path relative to the package root.
 * @returns `true` when the module's placeholders should be rewritten.
 */
export function isResolvableSource(relativePath: string): boolean {
	return !TEST_MODULE.test(relativePath);
}

/**
 * The version a package's placeholders resolve to. Private packages ship
 * nothing, so they have no introducing version to record.
 *
 * @param packageJsonText - Raw `package.json` contents.
 * @returns The published version, or `undefined` when nothing is published.
 */
export function publishedVersion(packageJsonText: string): string | undefined {
	const manifest = JSON.parse(packageJsonText);
	if (typeof manifest !== "object" || !manifest || Array.isArray(manifest)) {
		return undefined;
	}

	const { private: isPrivate, version } = manifest;
	if (isPrivate === true) {
		return undefined;
	}

	return typeof version === "string" ? version : undefined;
}

function comparableVersion(version: string): string | undefined {
	const [, triple] = VERSION.exec(version) ?? [];
	return triple
		?.split(".")
		.map((component) => component.padStart(COMPONENT_WIDTH, "0"))
		.join(".");
}
