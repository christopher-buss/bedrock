// The `@since` vocabulary shared by the public-API coverage guards and the
// release-time resolver.

/** Stands in for a version that the release plan has not yet decided. */
export const UNRELEASED_SINCE = "unreleased";

/** One module's text, addressed by its path relative to the package root. */
export interface SourceModule {
	/** Module path relative to the package root. */
	readonly path: string;
	/** The module's full source text. */
	readonly text: string;
}

const NUMERIC_IDENTIFIER = String.raw`0|[1-9]\d*`;
const PRERELEASE_IDENTIFIER = String.raw`${NUMERIC_IDENTIFIER}|\d*[A-Za-z-][\dA-Za-z-]*`;
const BUILD_IDENTIFIER = String.raw`[\dA-Za-z-]+`;

// The core triple is captured alone: a prerelease or build suffix is validated
// but excluded from ordering, since `0.1.5-beta.1` names the same release.
const VERSION = new RegExp(
	String.raw`^((?:${NUMERIC_IDENTIFIER})(?:\.(?:${NUMERIC_IDENTIFIER})){2})` +
		String.raw`(?:-(?:${PRERELEASE_IDENTIFIER})(?:\.(?:${PRERELEASE_IDENTIFIER}))*)?` +
		String.raw`(?:\+(?:${BUILD_IDENTIFIER})(?:\.(?:${BUILD_IDENTIFIER}))*)?$`,
	"u",
);

const COMPARABLE_COMPONENT_WIDTH = 10;

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
 * Plan the placeholder rewrites for one package's modules. Colocated tests are
 * left alone: they declare no public API, and a test pinning the placeholder
 * holds it as a fixture string.
 *
 * @param modules - The package's modules, keyed by package-relative path.
 * @param version - Version the pending symbols are shipping in.
 * @returns Only the modules whose text changed, carrying their new text.
 */
export function planSinceTagRewrites(
	modules: ReadonlyArray<SourceModule>,
	version: string,
): ReadonlyArray<SourceModule> {
	return modules.flatMap((module) => {
		if (TEST_MODULE.test(module.path)) {
			return [];
		}

		const text = resolveUnreleasedSinceTags(module.text, version);
		return text === module.text ? [] : [{ path: module.path, text }];
	});
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
		.map((component) => component.padStart(COMPARABLE_COMPONENT_WIDTH, "0"))
		.join(".");
}
