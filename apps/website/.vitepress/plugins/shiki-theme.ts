import type { ThemeRegistration } from "shiki";

/**
 * Warm earthy palette matched to the bedrock landing-page mockup.
 * Hand-tuned tans, sage greens, and rose accents over the dark code-card
 * surface; comments rendered italic in the muted dark-ink-3 grey.
 */
export const BEDROCK_WARM: ThemeRegistration = {
	name: "bedrock-warm",
	colors: {
		"editor.background": "#0f1320",
		"editor.foreground": "#b9c1d0",
		"editor.lineHighlightBackground": "#161c2c",
		"editor.selectionBackground": "#1e2434",
		"editorBracketMatch.background": "#1e2434",
		"editorBracketMatch.border": "#7a9ac4",
		"editorCursor.foreground": "#eef1f7",
		"editorIndentGuide.background1": "#1e2434",
		"editorLineNumber.activeForeground": "#b9c1d0",
		"editorLineNumber.foreground": "#6f7889",
		"terminal.background": "#080b12",
		"terminal.foreground": "#b9c1d0",
	},
	displayName: "Bedrock Warm",
	semanticHighlighting: true,
	tokenColors: [
		{
			scope: ["comment", "punctuation.definition.comment", "string.comment"],
			settings: { fontStyle: "italic", foreground: "#6f7889" },
		},
		{
			scope: ["string", "string.quoted", "string.template"],
			settings: { foreground: "#b8d4a8" },
		},
		{
			scope: ["constant.numeric", "constant.language.boolean", "constant.language.null"],
			settings: { foreground: "#d4a878" },
		},
		{
			scope: [
				"keyword",
				"keyword.control",
				"keyword.operator.new",
				"keyword.operator.expression",
				"storage.type",
				"storage.modifier",
				"variable.language.this",
				"variable.language.self",
			],
			settings: { foreground: "#c88a7a" },
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call entity.name.function",
				"variable.function",
			],
			settings: { foreground: "#dcc8a8" },
		},
		{
			scope: [
				"meta.object-literal.key",
				"support.type.property-name",
				"variable.other.property",
				"meta.property-name",
			],
			settings: { foreground: "#e6b472" },
		},
		{
			scope: [
				"entity.name.type",
				"entity.name.class",
				"entity.name.interface",
				"support.type",
				"support.class",
			],
			settings: { foreground: "#a8b8c8" },
		},
		{
			scope: ["punctuation", "meta.brace", "punctuation.separator", "punctuation.terminator"],
			settings: { foreground: "#6f7889" },
		},
		{
			scope: ["variable", "variable.other"],
			settings: { foreground: "#b9c1d0" },
		},
		{
			scope: ["constant", "constant.character", "constant.other"],
			settings: { foreground: "#d4a878" },
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: "#e6b472" },
		},
		{
			scope: ["entity.name.tag"],
			settings: { foreground: "#c88a7a" },
		},
		{
			scope: ["markup.heading"],
			settings: { foreground: "#eef1f7" },
		},
		{
			scope: ["markup.bold"],
			settings: { fontStyle: "bold", foreground: "#eef1f7" },
		},
		{
			scope: ["markup.italic"],
			settings: { fontStyle: "italic", foreground: "#b9c1d0" },
		},
		{
			scope: ["markup.inline.raw", "markup.fenced_code"],
			settings: { foreground: "#b8d4a8" },
		},
	],
	type: "dark",
};
