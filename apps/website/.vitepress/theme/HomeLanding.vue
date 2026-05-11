<script setup lang="ts">
import { ref } from "vue";
import { useData } from "vitepress";

import configHtml from "../../landing/examples/config.ts?highlighted";
import deployHtml from "../../landing/examples/deploy.ts?highlighted";

type TabId = "config" | "deploy" | "cli";

const { isDark } = useData();
const activeTab = ref<TabId>("config");

const tabs: Array<{ filename: string; id: TabId; label: string }> = [
	{ filename: "bedrock.config.ts", id: "config", label: "config.ts" },
	{ filename: ".bedrock/deploy.ts", id: "deploy", label: ".bedrock/deploy.ts" },
	{ filename: "shell", id: "cli", label: "cli" },
];

function toggleTheme(): void {
	isDark.value = !isDark.value;
}
</script>

<template>
	<div class="bedrock-landing">
		<nav class="bedrock-nav">
			<div class="wrap inner">
				<a class="brand" href="#">
					<span class="brand-mark">
						<span /><span /><span /><span />
					</span>
					Bedrock<span class="nav-v">v0.1</span>
				</a>
				<div class="nav-links">
					<a href="#pipeline">How it works</a>
					<a href="#features">Features</a>
					<a href="#install">Quickstart</a>
					<a href="#ecosystem">Ocale</a>
					<a href="/bedrock/guide/getting-started">Docs</a>
				</div>
				<button
					class="theme-toggle"
					aria-label="Toggle theme"
					@click="toggleTheme"
				>
					<svg
						v-if="!isDark"
						class="icon-moon"
						viewBox="0 0 16 16"
						fill="none"
					>
						<path
							d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linejoin="round"
						/>
					</svg>
					<svg
						v-else
						class="icon-sun"
						viewBox="0 0 16 16"
						fill="none"
					>
						<circle
							cx="8"
							cy="8"
							r="3"
							stroke="currentColor"
							stroke-width="1.4"
						/>
						<path
							d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<a
					class="nav-cta"
					href="https://github.com/christopher-buss/bedrock"
				>
					GitHub
					<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
						<path
							d="M3 9L9 3M9 3H4M9 3V8"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</a>
			</div>
		</nav>

		<div class="wrap hero-wrap">
			<section class="hero">
				<div class="strata" aria-hidden="true">
					<div class="band" style="top: 14%" />
					<div class="band" style="top: 32%" />
					<div class="band" style="top: 52%" />
					<div class="band" style="top: 72%" />
					<div class="band" style="top: 88%" />
				</div>
				<div class="glow" aria-hidden="true" />
				<div class="hero-inner">
					<div class="hero-text">
						<div class="eyebrow on-dark">
							Infrastructure-as-Code &middot; for Roblox
						</div>
						<h1>
							Declare your experience.<br><em>Reconcile</em> it.
						</h1>
						<p class="sub">
							Bedrock is a <b>TypeScript</b> library (with a CLI) that declares your
							Roblox resources &mdash; game passes, places, products, experience config &mdash;
							and reconciles them through <b>Open Cloud</b>. Built as a modern successor to Mantle.
						</p>
						<div class="ctas">
							<a class="btn btn-accent" href="#install">
								Get started
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
									<path
										d="M2 6H10M10 6L6.5 2.5M10 6L6.5 9.5"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</a>
							<a class="btn btn-ghost-dark" href="/bedrock/guide/getting-started">
								Read the docs
							</a>
						</div>
						<div class="meta">
							<div class="pip"><b>v0.1</b> &middot; early access</div>
							<div>MIT licensed</div>
							<div>Open Cloud only</div>
						</div>
					</div>

					<div class="code-card">
						<div class="code-head">
							<div class="code-filename">
								<span class="code-dot" />
								{{ tabs.find((tab) => tab.id === activeTab)?.filename }}
							</div>
							<div class="code-tabs">
								<button
									v-for="tab in tabs"
									:key="tab.id"
									:class="['code-tab', { active: activeTab === tab.id }]"
									@click="activeTab = tab.id"
								>
									{{ tab.label }}
								</button>
							</div>
						</div>
						<div v-show="activeTab === 'config'" class="code-pane" v-html="configHtml" />
						<div v-show="activeTab === 'deploy'" class="code-pane" v-html="deployHtml" />
						<div v-show="activeTab === 'cli'" class="code-pane cli-pane">
							<pre><span class="cli-prompt">$</span> bedrock diff      <span class="cli-dim"># preview changes</span>
<span class="cli-prompt">$</span> bedrock deploy    <span class="cli-dim"># reconcile</span>
<span class="cli-prompt">$</span> bedrock migrate ./mantle.yml</pre>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>

<style scoped>
.bedrock-landing {
	--bg: #f4f6fa;
	--bg-soft: #e9edf3;
	--bg-card: #ffffff;
	--bg-nav: rgba(244, 246, 250, 0.78);
	--ink: #0e131a;
	--ink-2: #2a3240;
	--ink-3: #5a6472;
	--ink-4: #8b95a4;
	--line: #dde2eb;
	--line-strong: #c4cbd6;

	--dark-bg: #0c1018;
	--dark-bg-2: #131826;
	--dark-bg-3: #1c2235;
	--dark-line: #232a3a;
	--dark-ink: #eef1f7;
	--dark-ink-2: #b9c1d0;
	--dark-ink-3: #6f7889;

	--accent: #5c7da6;
	--accent-soft: #a8bdd8;
	--accent-deep: #324a6e;
	--accent-bg: #e4ebf5;

	--ok: #4a8a64;

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Instrument Serif", "Times New Roman", serif;
	--f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

	--r-sm: 4px;
	--r: 8px;
	--r-lg: 14px;

	--ease: cubic-bezier(0.2, 0.7, 0.2, 1);

	min-height: 100vh;
	background: var(--bg);
	color: var(--ink);
	font-family: var(--f-sans);
	font-size: 16px;
	line-height: 1.55;
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

html.dark .bedrock-landing {
	--bg: #0d1119;
	--bg-soft: #141a26;
	--bg-card: #1a2030;
	--bg-nav: rgba(13, 17, 25, 0.78);
	--ink: #eef1f7;
	--ink-2: #c1c8d4;
	--ink-3: #828b9c;
	--ink-4: #565e6e;
	--line: #232a39;
	--line-strong: #2f3849;

	--dark-bg: #080b12;
	--dark-bg-2: #0f1320;
	--dark-bg-3: #161c2c;
	--dark-line: #1e2434;

	--accent: #7a9ac4;
	--accent-soft: #b8c9e0;
	--accent-deep: #4e6c92;
	--accent-bg: #1e2840;
}

.bedrock-landing,
.bedrock-landing .bedrock-nav,
.bedrock-landing .hero {
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-landing a {
	color: inherit;
	text-decoration: none;
}

.bedrock-landing button {
	font: inherit;
	cursor: pointer;
	border: 0;
	background: none;
	color: inherit;
	padding: 0;
}

.bedrock-landing ::selection {
	background: var(--accent);
	color: #fff;
}

.wrap {
	max-width: 1200px;
	margin: 0 auto;
	padding: 0 32px;
}

.bedrock-nav {
	position: sticky;
	top: 0;
	z-index: 40;
	backdrop-filter: blur(14px);
	background: var(--bg-nav);
	border-bottom: 1px solid var(--line);
}

.bedrock-nav .inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 60px;
}

.nav-links {
	display: flex;
	gap: 28px;
}

.nav-links a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.nav-links a:hover {
	color: var(--ink);
}

.nav-cta {
	font-size: 13px;
	padding: 6px 12px 6px 14px;
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	transition: all 0.15s var(--ease);
}

.nav-cta:hover {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--bg);
}

.nav-v {
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--ink-4);
	padding: 2px 6px;
	background: var(--bg-soft);
	border-radius: 3px;
	margin-left: 8px;
}

.theme-toggle {
	width: 32px;
	height: 32px;
	border: 1px solid var(--line);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--ink-2);
	transition: all 0.15s var(--ease);
	margin-right: 6px;
}

.theme-toggle:hover {
	border-color: var(--ink-3);
	color: var(--ink);
	background: var(--bg-soft);
}

.theme-toggle svg {
	width: 14px;
	height: 14px;
}

.brand {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	font-family: var(--f-serif);
	font-size: 23px;
	letter-spacing: -0.01em;
}

.brand-mark {
	width: 22px;
	height: 22px;
	display: grid;
	grid-template-rows: repeat(4, 1fr);
	gap: 2px;
}

.brand-mark span {
	background: var(--ink);
	border-radius: 1px;
}

.brand-mark span:nth-child(1) {
	opacity: 0.3;
}

.brand-mark span:nth-child(2) {
	opacity: 0.55;
}

.brand-mark span:nth-child(3) {
	opacity: 0.8;
}

.brand-mark span:nth-child(4) {
	background: var(--accent);
	opacity: 1;
}

/* Eyebrow */
.eyebrow {
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-3);
	display: inline-flex;
	align-items: center;
	gap: 10px;
}

.eyebrow::before {
	content: "";
	width: 18px;
	height: 1px;
	background: currentColor;
}

.eyebrow.on-dark {
	color: var(--dark-ink-3);
}

/* Buttons */
.btn {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 11px 18px;
	border-radius: 999px;
	font-size: 14px;
	font-weight: 500;
	border: 1px solid transparent;
	transition: all 0.15s var(--ease);
	white-space: nowrap;
}

.btn-accent {
	background: var(--accent);
	color: #fff;
}

.btn-accent:hover {
	background: color-mix(in oklch, var(--accent), #fff 8%);
	transform: translateY(-1px);
}

.btn-ghost-dark {
	border-color: var(--dark-line);
	color: var(--dark-ink-2);
}

.btn-ghost-dark:hover {
	border-color: var(--dark-ink-3);
	color: var(--dark-ink);
}

.btn svg {
	transition: transform 0.2s var(--ease);
}

.btn:hover svg {
	transform: translateX(2px);
}

/* Hero shell — always dark per the design (the "stratum") */
.hero-wrap {
	margin-top: 0;
}

.hero {
	position: relative;
	overflow: hidden;
	border: 1px solid var(--dark-line);
	border-radius: var(--r-lg);
	margin: 24px auto;
	max-width: 1200px;
	background: var(--dark-bg);
	color: var(--dark-ink);
}

.strata {
	position: absolute;
	inset: 0;
	pointer-events: none;
	opacity: 0.45;
}

.strata .band {
	position: absolute;
	left: 0;
	right: 0;
	border-top: 1px solid var(--dark-line);
}

.glow {
	position: absolute;
	inset: -40% -20% auto -20%;
	height: 70%;
	background: radial-gradient(
		ellipse at 60% 40%,
		color-mix(in oklch, var(--accent) 18%, transparent),
		transparent 60%
	);
	pointer-events: none;
}

.hero-inner {
	position: relative;
	display: grid;
	grid-template-columns: 1.05fr 1fr;
	gap: 56px;
	align-items: start;
	padding: 80px 16px 88px;
}

.hero-text h1 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(48px, 6vw, 82px);
	line-height: 0.98;
	letter-spacing: -0.02em;
	margin: 20px 0 22px;
	color: var(--dark-ink);
}

.hero-text h1 em {
	font-style: italic;
	color: var(--accent-soft);
}

.hero-text .sub {
	font-size: 18px;
	color: var(--dark-ink-2);
	max-width: 44ch;
	line-height: 1.55;
	margin-bottom: 28px;
}

.hero-text .sub b {
	color: var(--dark-ink);
	font-weight: 500;
}

.hero-text .ctas {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}

.hero-text .meta {
	margin-top: 36px;
	display: flex;
	gap: 24px;
	flex-wrap: wrap;
	font-family: var(--f-mono);
	font-size: 12px;
	color: var(--dark-ink-3);
}

.hero-text .meta b {
	color: var(--dark-ink);
	font-weight: 500;
}

.hero-text .meta .pip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.hero-text .meta .pip::before {
	content: "";
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--ok);
}

/* Code card */
.code-card {
	background: var(--dark-bg-2);
	border: 1px solid var(--dark-line);
	border-radius: var(--r-lg);
	overflow: hidden;
	box-shadow: 0 20px 60px -20px rgba(0, 0, 0, 0.5);
	position: relative;
}

.code-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	border-bottom: 1px solid var(--dark-line);
	background: rgba(255, 255, 255, 0.02);
}

.code-filename {
	font-family: var(--f-mono);
	font-size: 12px;
	color: var(--dark-ink-3);
	display: flex;
	align-items: center;
	gap: 8px;
}

.code-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--accent);
}

.code-tabs {
	display: flex;
	gap: 2px;
	font-family: var(--f-mono);
	font-size: 12px;
}

.code-tab {
	padding: 6px 12px;
	color: var(--dark-ink-3);
	border-radius: var(--r-sm);
	transition: all 0.15s var(--ease);
}

.code-tab.active {
	color: var(--dark-ink);
	background: rgba(255, 255, 255, 0.05);
}

.code-tab:not(.active):hover {
	color: var(--dark-ink-2);
}

.code-pane {
	min-height: 280px;
}

/* Shiki output styling (via :deep since v-html bypasses scoped CSS) */
.code-pane :deep(pre.shiki) {
	margin: 0;
	padding: 22px 24px;
	background: transparent !important;
	font-family: var(--f-mono);
	font-size: 13px;
	line-height: 1.7;
	overflow-x: auto;
}

.code-pane :deep(pre.shiki code) {
	background: transparent;
}

/* CLI mock pane */
.cli-pane pre {
	margin: 0;
	padding: 22px 24px;
	font-family: var(--f-mono);
	font-size: 13px;
	line-height: 1.8;
	color: var(--dark-ink-2);
	overflow-x: auto;
}

.cli-prompt {
	color: var(--accent-soft);
}

.cli-dim {
	color: var(--dark-ink-3);
}
</style>
