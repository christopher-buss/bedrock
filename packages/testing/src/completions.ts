import path from "node:path";
import ts from "typescript";

const MARKER = "/*|*/";

/**
 * Asks the TypeScript language service what an editor would complete. Type
 * tests check what a value resolves to; this checks what the author is
 * offered while typing it, which can differ (for example, when an overload
 * other than the one that resolves supplies the contextual type).
 */
export interface CompletionProbe {
	/**
	 * Complete at the `/*|*\/` marker in `source`, as an editor would.
	 *
	 * @param source - Module text containing one marker. It is placed in the
	 * project directory, so relative imports resolve from there.
	 * @returns The offered completion names, empty where none are offered.
	 */
	readonly completionsAt: (source: string) => Array<string>;
}

/** Options for {@link createCompletionProbe}. */
export interface CompletionProbeOptions {
	/** Directory whose `tsconfig.json` supplies the compiler options. */
	readonly projectDirectory: string;
}

/** The one in-memory module the language service completes in. */
interface ProbeModule {
	readonly directory: string;
	readonly file: string;
	source: string;
}

/**
 * Build one language service for a project. Building it loads the standard
 * library, so create it once per spec file and reuse it across cases.
 *
 * @param options - Where the project's `tsconfig.json` lives.
 * @returns A probe that completes at a marker in a module of the project.
 */
export function createCompletionProbe({
	projectDirectory,
}: CompletionProbeOptions): CompletionProbe {
	const compilerOptions = readCompilerOptions(projectDirectory);
	const probe: ProbeModule = {
		directory: projectDirectory,
		file: normalize(path.join(projectDirectory, "__completion-probe__.ts")),
		source: "",
	};
	const service = ts.createLanguageService(createHost(probe, compilerOptions));

	return {
		completionsAt(source) {
			const position = source.indexOf(MARKER);
			if (position === -1) {
				throw new Error(`Source has no ${MARKER} marker to complete at.`);
			}

			probe.source = source;
			const info = service.getCompletionsAtPosition(probe.file, position, {});
			return info?.entries.map((entry) => entry.name) ?? [];
		},
	};
}

function normalize(file: string): string {
	return file.split(path.sep).join("/");
}

function createHost(
	probe: ProbeModule,
	compilerOptions: ts.CompilerOptions,
): ts.LanguageServiceHost {
	/**
	 * The probe text doubles as its script version, and a disk file's path as
	 * its own, so the service re-reads exactly what changed between calls.
	 *
	 * @param file - Path the language service asks about.
	 * @returns The probe text for the probe file, otherwise `undefined`.
	 */
	function inMemoryText(file: string): string | undefined {
		return normalize(file) === probe.file ? probe.source : undefined;
	}

	return {
		directoryExists: (directory) => ts.sys.directoryExists(directory),
		fileExists: (file) => ts.sys.fileExists(file),
		getCompilationSettings: () => compilerOptions,
		getCurrentDirectory: () => probe.directory,
		getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
		getScriptFileNames: () => [probe.file],
		getScriptSnapshot: (file) => {
			const text = inMemoryText(file) ?? ts.sys.readFile(file);
			return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
		},
		getScriptVersion: (file) => inMemoryText(file) ?? file,
		readFile: (file) => ts.sys.readFile(file),
	};
}

function readCompilerOptions(projectDirectory: string): ts.CompilerOptions {
	const configPath = path.join(projectDirectory, "tsconfig.json");
	const read: { config?: JSONValue; error?: ts.Diagnostic } = ts.readConfigFile(
		configPath,
		(file) => ts.sys.readFile(file),
	);
	if (read.error !== undefined) {
		throw new Error(`Cannot read ${configPath}.`);
	}

	return ts.parseJsonConfigFileContent(
		read.config,
		ts.sys,
		projectDirectory,
		undefined,
		configPath,
	).options;
}
