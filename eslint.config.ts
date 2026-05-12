import type { Rules } from "@isentinel/eslint-config";
import isentinel, { GLOB_MARKDOWN_CODE, GLOB_SRC } from "@isentinel/eslint-config";
import tsParser from "@typescript-eslint/parser";

import { mergeProcessors } from "eslint-merge-processors";
import pluginVue from "eslint-plugin-vue";
import pluginVueA11y from "eslint-plugin-vuejs-accessibility";
import processorVueBlocks from "eslint-processor-vue-blocks";
import parserVue from "vue-eslint-parser";

const VUE_GLOBALS = {
	computed: "readonly",
	defineEmits: "readonly",
	defineExpose: "readonly",
	defineProps: "readonly",
	onMounted: "readonly",
	onUnmounted: "readonly",
	reactive: "readonly",
	ref: "readonly",
	shallowReactive: "readonly",
	shallowRef: "readonly",
	toRef: "readonly",
	toRefs: "readonly",
	watch: "readonly",
	watchEffect: "readonly",
};

function flattenRules(
	configs: ReadonlyArray<{ rules?: Record<string, unknown> }>,
): Record<string, unknown> {
	return configs.reduce<Record<string, unknown>>(
		(accumulator, config) => ({ ...accumulator, ...config.rules }),
		{},
	);
}

const VUE_RULES: Rules = {
	...pluginVue.configs.base.rules,
	...flattenRules(pluginVue.configs["flat/essential"]),
	...flattenRules(pluginVue.configs["flat/strongly-recommended"]),
	...flattenRules(pluginVue.configs["flat/recommended"]),

	"vue-a11y/alt-text": "error",
	"vue-a11y/anchor-has-content": "error",
	"vue-a11y/aria-props": "error",
	"vue-a11y/aria-role": "error",
	"vue-a11y/aria-unsupported-elements": "error",
	"vue-a11y/click-events-have-key-events": "error",
	"vue-a11y/form-control-has-label": "error",
	"vue-a11y/heading-has-content": "error",
	"vue-a11y/iframe-has-title": "error",
	"vue-a11y/interactive-supports-focus": "error",
	"vue-a11y/label-has-for": "error",
	"vue-a11y/media-has-caption": "warn",
	"vue-a11y/mouse-events-have-key-events": "error",
	"vue-a11y/no-access-key": "error",
	"vue-a11y/no-aria-hidden-on-focusable": "error",
	"vue-a11y/no-autofocus": "warn",
	"vue-a11y/no-distracting-elements": "error",
	"vue-a11y/no-redundant-roles": "error",
	"vue-a11y/no-role-presentation-on-focusable": "error",
	"vue-a11y/no-static-element-interactions": "error",
	"vue-a11y/role-has-required-aria-props": "error",
	"vue-a11y/tabindex-no-positive": "warn",

	"vue/array-bracket-spacing": ["error", "never"],
	"vue/arrow-spacing": ["error", { after: true, before: true }],
	"vue/block-order": ["error", { order: ["script", "template", "style"] }],
	"vue/block-spacing": ["error", "always"],
	"vue/block-tag-newline": ["error", { multiline: "always", singleline: "always" }],
	"vue/brace-style": ["error", "stroustrup", { allowSingleLine: true }],
	"vue/comma-dangle": ["error", "always-multiline"],
	"vue/comma-spacing": ["error", { after: true, before: false }],
	"vue/comma-style": ["error", "last"],
	"vue/component-name-in-template-casing": ["error", "PascalCase"],
	"vue/component-options-name-casing": ["error", "PascalCase"],
	"vue/component-tags-order": "off",
	"vue/custom-event-name-casing": ["error", "camelCase"],
	"vue/define-macros-order": [
		"error",
		{ order: ["defineOptions", "defineProps", "defineEmits", "defineSlots"] },
	],
	"vue/dot-location": ["error", "property"],
	"vue/dot-notation": ["error", { allowKeywords: true }],
	"vue/eqeqeq": ["error", "smart"],
	"vue/html-closing-bracket-newline": "off",
	"vue/html-comment-content-spacing": ["error", "always", { exceptions: ["-"] }],
	"vue/html-indent": "off",
	"vue/html-quotes": ["error", "double"],
	"vue/html-self-closing": "off",
	"vue/key-spacing": ["error", { afterColon: true, beforeColon: false }],
	"vue/keyword-spacing": ["error", { after: true, before: true }],
	"vue/max-attributes-per-line": "off",
	"vue/multi-word-component-names": "off",
	"vue/no-dupe-keys": "off",
	"vue/no-empty-pattern": "error",
	"vue/no-irregular-whitespace": "error",
	"vue/no-loss-of-precision": "error",
	"vue/no-restricted-syntax": ["error", "DebuggerStatement", "LabeledStatement", "WithStatement"],
	"vue/no-restricted-v-bind": ["error", "/^v-/"],
	"vue/no-setup-props-reactivity-loss": "off",
	"vue/no-sparse-arrays": "error",
	"vue/no-unused-refs": "error",
	"vue/no-useless-v-bind": "error",
	"vue/no-v-html": "off",
	"vue/object-curly-newline": "off",
	"vue/object-curly-spacing": ["error", "always"],
	"vue/object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
	"vue/object-shorthand": ["error", "always", { avoidQuotes: true, ignoreConstructors: false }],
	"vue/operator-linebreak": ["error", "before"],
	"vue/padding-line-between-blocks": ["error", "always"],
	"vue/prefer-separate-static-class": "error",
	"vue/prefer-template": "error",
	"vue/prop-name-casing": ["error", "camelCase"],
	"vue/quote-props": ["error", "consistent-as-needed"],
	"vue/require-default-prop": "off",
	"vue/require-prop-types": "off",
	"vue/singleline-html-element-content-newline": "off",
	"vue/space-in-parens": ["error", "never"],
	"vue/space-infix-ops": "error",
	"vue/space-unary-ops": ["error", { nonwords: false, words: true }],
	"vue/template-curly-spacing": "error",
};

export default isentinel(
	{
		name: "bedrock/root",
		componentExts: ["vue"],
		flawless: true,
		ignores: [
			"!.claude",
			"!.claude/settings.json",
			"!.claude/hooks/**",
			"**/*.example.spec.ts",
			"**/vendor/**",
			".sandcastle/plans/**",
			".sandcastle/worktrees/**",
			"packages/bedrock/tests/fixtures/**/*.yml",
			"packages/open-cloud/src/locales/data.generated.ts",
		],
		namedConfigs: true,
		pnpm: true,
		roblox: false,
		test: {
			vitest: {
				extended: true,
				typecheck: true,
			},
		},
		type: "package",
		typescript: {
			erasableOnly: true,
		},
	},
	{
		name: "project/config",
		files: ["*.config.{ts,js}"],
		rules: {
			"flawless/naming-convention": "off",
		},
	},
	{
		name: "project/github-required-filenames",
		files: [".github/FUNDING.{yml,yaml}"],
		rules: {
			"unicorn/filename-case": "off",
		},
	},
	{
		name: "project/src",
		files: [`packages/*/*/${GLOB_SRC}`],
		rules: {
			"better-max-params/better-max-params": ["error", { func: 2 }],
			"unicorn/no-null": "error",
		},
	},
	{
		name: "project/jsdoc",
		files: [GLOB_SRC],
		ignores: [GLOB_MARKDOWN_CODE],
		rules: {
			"jsdoc/require-jsdoc": [
				"warn",
				{
					contexts: [
						"TSInterfaceDeclaration",
						"TSTypeAliasDeclaration",
						"TSEnumDeclaration",
						"TSMethodSignature",
						"TSPropertySignature",
					],
					publicOnly: { ancestorsOnly: true },
					require: {
						ArrowFunctionExpression: true,
						ClassDeclaration: true,
						FunctionDeclaration: true,
						FunctionExpression: true,
						MethodDefinition: true,
					},
				},
			],
		},
	},
	{
		name: "project/sandcastle",
		files: [".sandcastle/**/*.ts"],
		rules: {
			"antfu/no-top-level-await": "off",
			"no-console": "off",
		},
	},
	{
		name: "project/docs",
		files: ["apps/website/landing/examples/**/*.ts"],
		rules: {
			"antfu/no-top-level-await": "off",
			"no-console": "off",
		},
	},
	{
		name: "project/vue/setup",
		files: ["**/*.vue"],
		languageOptions: { globals: { ...VUE_GLOBALS } },
		plugins: {
			"vue": pluginVue,
			"vue-a11y": pluginVueA11y,
		},
	},
	{
		name: "project/vue/rules",
		files: ["**/*.vue"],
		languageOptions: {
			parser: parserVue,
			parserOptions: {
				ecmaFeatures: { jsx: true },
				extraFileExtensions: [".vue"],
				parser: tsParser,
				sourceType: "module",
			},
		},
		// eslint-disable-next-line ts/no-unsafe-argument -- pluginVue.processors[".vue"] is typed as `any` upstream
		processor: mergeProcessors([
			pluginVue.processors[".vue"],
			processorVueBlocks({ blocks: { styles: true } }),
		]),
		rules: { ...VUE_RULES },
	},
);
