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
		"editor.foreground": "#dcd7ca",
	},
	tokenColors: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { fontStyle: "italic", foreground: "#6f7889" },
		},
		{
			scope: [
				"keyword",
				"keyword.control",
				"keyword.operator.new",
				"storage.type",
				"storage.modifier",
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
			scope: ["string", "punctuation.definition.string"],
			settings: { foreground: "#b8d4a8" },
		},
		{
			scope: ["constant.numeric", "constant.language"],
			settings: { foreground: "#d4a878" },
		},
		{
			scope: [
				"meta.object-literal.key",
				"variable.other.property",
				"support.type.property-name",
			],
			settings: { foreground: "#e6b472" },
		},
		{
			scope: ["entity.name.type", "support.type", "support.class"],
			settings: { foreground: "#a8b8c8" },
		},
		{
			scope: ["punctuation", "meta.brace", "meta.delimiter"],
			settings: { foreground: "#6f7889" },
		},
		{
			scope: ["variable", "variable.other"],
			settings: { foreground: "#dcd7ca" },
		},
	],
	type: "dark",
};
