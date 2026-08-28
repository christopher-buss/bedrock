<script setup lang="ts">
import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

import { useData } from "vitepress";
import { ref } from "vue";

import configHtml from "../../landing/examples/config.ts?highlighted";
import deployHtml from "../../landing/examples/deploy.ts?highlighted";

const VERSION = `v${bedrockVersion}`;
const REPOSITORY = "https://github.com/christopher-buss/bedrock";

type TabId = "config" | "deploy" | "cli";

const { isDark } = useData();
const activeTab = ref<TabId>("config");

const tabs: ReadonlyArray<{
	readonly filename: string;
	readonly id: TabId;
	readonly label: string;
}> = [
	{ filename: "bedrock.config.ts", id: "config", label: "config" },
	{ filename: ".bedrock/deploy.ts", id: "deploy", label: "deploy" },
	{ filename: "shell", id: "cli", label: "cli" },
];

const NEXT_CODE_TAB: Record<TabId, Record<"left" | "right", TabId>> = {
	cli: { left: "deploy", right: "config" },
	config: { left: "cli", right: "deploy" },
	deploy: { left: "config", right: "cli" },
};

function navigateCodeTab(event: KeyboardEvent, fromId: TabId): void {
	if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
		return;
	}

	event.preventDefault();
	const direction = event.key === "ArrowRight" ? "right" : "left";
	const nextId = NEXT_CODE_TAB[fromId][direction];
	activeTab.value = nextId;
	document.getElementById(`code-tab-${nextId}`)?.focus();
}

function toggleTheme(): void {
	isDark.value = !isDark.value;
}
</script>

<template>
	<div class="bedrock-soon">
		<nav class="bedrock-nav">
			<div class="wrap inner">
				<a class="brand" :href="REPOSITORY">
					<span class="brand-mark"> <span /><span /><span /><span /> </span>
					Bedrock<span class="nav-v">{{ VERSION }}</span>
				</a>
				<div class="nav-right">
					<button class="theme-toggle" aria-label="Toggle theme" @click="toggleTheme">
						<svg v-if="!isDark" class="icon-moon" viewBox="0 0 16 16" fill="none">
							<path
								d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linejoin="round"
							/>
						</svg>
						<svg v-else class="icon-sun" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4" />
							<path
								d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
					</button>
					<a class="nav-cta" :href="REPOSITORY">
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
						<h1>Declare your experience.<br /><em>Deploy</em> it.</h1>
						<p class="sub">
							Write your game passes, products, and experience config as code. Make
							changes with confidence from a single source of truth. A spiritual
							successor to Mantle.
						</p>
						<div class="notice">
							<span class="notice-tag">Coming soon</span>
							<p>
								Bedrock is being built in the open, and the documentation is still
								being written. Until it is ready, the source, issues, and roadmap
								live on GitHub.
							</p>
						</div>
						<div class="ctas">
							<a class="btn btn-accent" :href="REPOSITORY">
								Follow on GitHub
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
						</div>
						<div class="meta">
							<div class="pip">
								<b>{{ VERSION }}</b> &middot; pre-1.0 &middot; MIT licensed
							</div>
						</div>
					</div>

					<div class="code-card">
						<div class="code-head">
							<div class="code-filename">
								<span class="code-dot" />
								{{ tabs.find((tab) => tab.id === activeTab)?.filename }}
							</div>
							<div class="code-tabs" role="tablist" aria-label="Code sample">
								<button
									v-for="tab in tabs"
									:id="`code-tab-${tab.id}`"
									:key="tab.id"
									role="tab"
									type="button"
									class="code-tab"
									:class="[{ active: activeTab === tab.id }]"
									:aria-selected="activeTab === tab.id"
									:aria-controls="`code-panel-${tab.id}`"
									:tabindex="activeTab === tab.id ? 0 : -1"
									@click="activeTab = tab.id"
									@keydown="navigateCodeTab($event, tab.id)"
								>
									{{ tab.label }}
								</button>
							</div>
						</div>
						<div
							v-show="activeTab === 'config'"
							id="code-panel-config"
							role="tabpanel"
							aria-labelledby="code-tab-config"
							tabindex="0"
							class="code-pane"
							v-html="configHtml"
						/>
						<div
							v-show="activeTab === 'deploy'"
							id="code-panel-deploy"
							role="tabpanel"
							aria-labelledby="code-tab-deploy"
							tabindex="0"
							class="code-pane"
							v-html="deployHtml"
						/>
						<div
							v-show="activeTab === 'cli'"
							id="code-panel-cli"
							role="tabpanel"
							aria-labelledby="code-tab-cli"
							tabindex="0"
							class="code-pane cli-pane"
						>
							<pre><span class="cli-prompt">$</span> bedrock diff      <span class="cli-dim"># preview changes</span>
<span class="cli-prompt">$</span> bedrock deploy    <span class="cli-dim"># reconcile</span>
<span class="cli-prompt">$</span> bedrock migrate ./mantle.yaml</pre>
						</div>
					</div>
				</div>
			</section>
		</div>

		<footer class="bedrock-foot">
			<div class="wrap foot-bottom">
				<div>&copy; 2026 &middot; MIT Licensed &middot; {{ VERSION }}</div>
				<div>built with vitepress</div>
			</div>
		</footer>
	</div>
</template>

<style scoped>
.bedrock-soon {
	--bg: #f4f6fa;
	--bg-soft: #e9edf3;
	--bg-nav: rgba(244, 246, 250, 0.78);
	--ink: #0e131a;
	--ink-2: #2a3240;
	--ink-3: #5a6472;
	--ink-4: #8b95a4;
	--line: #dde2eb;
	--line-strong: #c4cbd6;

	--dark-bg: #0c1018;
	--dark-bg-2: #131826;
	--dark-line: #232a3a;
	--dark-ink: #eef1f7;
	--dark-ink-2: #b9c1d0;
	--dark-ink-3: #6f7889;

	--accent: #5944a2;
	--accent-soft: #a8bdd8;

	--ok: #4a8a64;

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Source Serif 4", "Times New Roman", serif;
	--f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

	--r-sm: 4px;
	--r-lg: 14px;

	--ease: cubic-bezier(0.2, 0.7, 0.2, 1);

	display: flex;
	flex-direction: column;
	min-height: 100vh;
	background: var(--bg);
	color: var(--ink);
	font-family: var(--f-sans);
	font-size: 16px;
	line-height: 1.55;
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

html.dark .bedrock-soon {
	--bg: #0d1119;
	--bg-soft: #141a26;
	--bg-nav: rgba(13, 17, 25, 0.78);
	--ink: #eef1f7;
	--ink-2: #c1c8d4;
	--ink-3: #828b9c;
	--ink-4: #565e6e;
	--line: #232a39;
	--line-strong: #2f3849;

	--dark-bg: #080b12;
	--dark-bg-2: #0f1320;
	--dark-line: #1e2434;

	--accent: #5944a2;
	--accent-soft: #b8c9e0;
}

.bedrock-soon,
.bedrock-soon .bedrock-nav,
.bedrock-soon .hero {
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-soon a {
	color: inherit;
	text-decoration: none;
}

.bedrock-soon button {
	font: inherit;
	cursor: pointer;
	border: 0;
	background: none;
	color: inherit;
	padding: 0;
}

.bedrock-soon ::selection {
	background: var(--accent);
	color: #fff;
}

.wrap {
	max-width: 1200px;
	margin: 0 auto;
	padding: 0 32px;
	width: 100%;
}

.hero-wrap {
	flex: 1;
	display: flex;
	align-items: center;
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

.nav-right {
	display: flex;
	align-items: center;
	gap: 6px;
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
	background: #6553aa;
	color: #fff;
}

.btn-accent:hover {
	background: color-mix(in oklch, #6553aa, #fff 8%);
	transform: translateY(-1px);
}

.btn svg {
	transition: transform 0.2s var(--ease);
}

.btn:hover svg {
	transform: translateX(2px);
}

.hero {
	position: relative;
	overflow: hidden;
	border: 1px solid var(--dark-line);
	border-radius: var(--r-lg);
	margin: 24px auto;
	max-width: 1200px;
	width: 100%;
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
	padding: 80px 48px 88px;
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
	font-weight: 900;
	color: #8b84ba;
}

.hero-text .sub {
	font-size: 18px;
	color: var(--dark-ink-2);
	max-width: 44ch;
	line-height: 1.55;
	margin-bottom: 28px;
}

.notice {
	border: 1px solid var(--dark-line);
	border-left: 2px solid var(--accent-soft);
	border-radius: var(--r-sm);
	background: rgba(255, 255, 255, 0.02);
	padding: 16px 18px;
	max-width: 46ch;
	margin-bottom: 28px;
}

.notice-tag {
	display: inline-block;
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--accent-soft);
	margin-bottom: 8px;
}

.notice p {
	margin: 0;
	font-size: 15px;
	line-height: 1.6;
	color: var(--dark-ink-2);
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
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
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
	gap: 8px;
	font-family: var(--f-mono);
	font-size: 12px;
}

.code-tabs .code-tab {
	padding: 7px 14px;
	color: var(--dark-ink-3);
	border-radius: var(--r-sm);
	border: 1px solid transparent;
	transition: all 0.15s var(--ease);
}

.code-tabs .code-tab.active {
	color: var(--dark-ink);
	background: rgba(255, 255, 255, 0.05);
	border-color: var(--dark-line);
}

.code-tabs .code-tab:not(.active):hover {
	color: var(--dark-ink-2);
}

.code-pane {
	min-height: 280px;
}

.code-pane :deep(pre.shiki) {
	margin: 0;
	padding: 22px 24px;
	background: transparent !important;
	font-family: var(--f-mono);
	font-size: 13px;
	line-height: 1.7;
	tab-size: 4;
	-moz-tab-size: 4;
	overflow-x: auto;
}

.code-pane :deep(pre.shiki code) {
	background: transparent;
}

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

.bedrock-foot {
	padding: 32px 0;
	background: var(--bg-soft);
	border-top: 1px solid var(--line);
}

.foot-bottom {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
	font-size: 12px;
	color: var(--ink-4);
	font-family: var(--f-mono);
}

@media (max-width: 960px) {
	.hero-inner {
		grid-template-columns: 1fr;
		gap: 40px;
	}
}

@media (max-width: 640px) {
	.wrap {
		padding: 0 20px;
	}

	.bedrock-soon .hero-inner {
		padding: 56px 16px 64px;
	}
}
</style>
