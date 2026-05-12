<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useData } from "vitepress";

import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

import configHtml from "../../landing/examples/config.ts?highlighted";
import deployHtml from "../../landing/examples/deploy.ts?highlighted";
import programmaticHtml from "../../landing/examples/programmatic.ts?highlighted";

const VERSION = `v${bedrockVersion}`;

type TabId = "config" | "deploy" | "cli";
type TermId = "diff" | "deploy" | "migrate";

const INSTALL_COMMAND = "pnpm add @bedrock-rbx/core";
const COPIED_RESET_MS = 1200;

const { isDark } = useData();
const activeTab = ref<TabId>("config");
const activeTerm = ref<TermId>("diff");
const copyState = ref<"idle" | "copied">("idle");
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

async function copyInstall(): Promise<void> {
	const clipboard = navigator.clipboard;
	if (clipboard === undefined) {
		// no clipboard API; nothing to show as success.
		return;
	}

	try {
		await clipboard.writeText(INSTALL_COMMAND);
	} catch {
		// permission denied or write rejected.
		return;
	}

	copyState.value = "copied";
	if (copyResetTimer !== undefined) {
		clearTimeout(copyResetTimer);
	}
	copyResetTimer = setTimeout(() => {
		copyState.value = "idle";
		copyResetTimer = undefined;
	}, COPIED_RESET_MS);
}

onBeforeUnmount(() => {
	if (copyResetTimer !== undefined) {
		clearTimeout(copyResetTimer);
	}
});

const tabs: ReadonlyArray<{
	readonly filename: string;
	readonly id: TabId;
	readonly label: string;
}> = [
	{ filename: "bedrock.config.ts", id: "config", label: "config" },
	{ filename: ".bedrock/deploy.ts", id: "deploy", label: "deploy" },
	{ filename: "shell", id: "cli", label: "cli" },
];

const TERM_IDS: ReadonlyArray<TermId> = ["diff", "deploy", "migrate"];

function focusTabButton(prefix: string, id: string): void {
	const button = document.getElementById(`${prefix}-tab-${id}`);
	button?.focus();
}

function navigateCodeTab(event: KeyboardEvent, index: number): void {
	if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
		return;
	}

	event.preventDefault();
	const direction = event.key === "ArrowRight" ? 1 : -1;
	const nextIndex = (index + direction + tabs.length) % tabs.length;
	const nextTab = tabs[nextIndex];
	if (nextTab === undefined) {
		return;
	}

	activeTab.value = nextTab.id;
	focusTabButton("code", nextTab.id);
}

function navigateTerminalTab(event: KeyboardEvent, index: number): void {
	if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
		return;
	}

	event.preventDefault();
	const direction = event.key === "ArrowRight" ? 1 : -1;
	const nextIndex = (index + direction + TERM_IDS.length) % TERM_IDS.length;
	const nextId = TERM_IDS[nextIndex];
	if (nextId === undefined) {
		return;
	}

	activeTerm.value = nextId;
	focusTabButton("term", nextId);
}

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
					Bedrock<span class="nav-v">{{ VERSION }}</span>
				</a>
				<div class="nav-links">
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
							Declare your experience.<br><em>Deploy</em> it.
						</h1>
						<p class="sub">
							Write your game passes, products, and experience config as code.
							Make changes with confidence from a single source of truth.
							A spiritual successor to Mantle.
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
							<div class="pip"><b>{{ VERSION }}</b> &middot; alpha &middot; MIT licensed</div>
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
									v-for="(tab, index) in tabs"
									:id="`code-tab-${tab.id}`"
									:key="tab.id"
									role="tab"
									type="button"
									:class="['code-tab', { active: activeTab === tab.id }]"
									:aria-selected="activeTab === tab.id"
									:aria-controls="`code-panel-${tab.id}`"
									:tabindex="activeTab === tab.id ? 0 : -1"
									@click="activeTab = tab.id"
									@keydown="navigateCodeTab($event, index)"
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

		<section class="tracks">
			<div class="wrap">
				<div class="tracks-head">
					<div>
						<div class="eyebrow">01 &middot; Two surfaces &middot; one library</div>
						<h2>One library, <em>two</em> ways in.</h2>
					</div>
				</div>
				<div class="tracks-grid">
					<div class="track">
						<div class="tag">Command line</div>
						<h3>From the <em>terminal</em>.</h3>
						<p class="lede">
							Run <code>bedrock deploy</code> against your config and you're done.
							Need to customise a step? Drop a TypeScript file in <code>.bedrock/</code>
							- the CLI calls it instead of the built-in.
						</p>
						<pre class="track-code"><span class="dim"># pick your config format</span>
<span class="prompt">$</span> bedrock init --format yaml
<span class="prompt">$</span> bedrock diff     <span class="dim"># preview changes</span>
<span class="prompt">$</span> bedrock deploy   <span class="dim"># reconcile</span>

<span class="dim"># migrating from Mantle?</span>
<span class="prompt">$</span> bedrock migrate ./mantle.yaml</pre>
						<div class="track-note">&rarr; <b>bedrock init</b> &middot; <b>diff</b> &middot; <b>deploy</b> &middot; <b>migrate</b></div>
					</div>

					<div class="track">
						<div class="tag">Programmatic</div>
						<h3>From your <em>code</em>.</h3>
						<p class="lede">
							Import any step from <code>@bedrock-rbx/core</code> and call it directly.
							Trigger deploys from a web backend, a chat bot, or any service in
							your stack.
						</p>
						<div class="track-code-shiki" v-html="programmaticHtml" />
						<div class="track-note">&rarr; public API &middot; typed &middot; semver'd &middot; extensible</div>
					</div>
				</div>
			</div>
		</section>

		<section id="features" class="features">
			<div class="wrap">
				<div class="features-head">
					<div>
						<div class="eyebrow">02 &middot; Design choices</div>
						<h2>Four decisions, <em>baked</em> in.</h2>
					</div>
					<p>
						Bedrock only manages what you list. Resources outside the config
						stay exactly where they are.
					</p>
				</div>

				<div class="feature-grid">
					<div class="feature">
						<div class="feature-glyph gl-grid"><span /><span /><span /><span /></div>
						<div class="feature-num">&rarr; 01</div>
						<h3>Typed configs</h3>
						<p>
							Luau, TypeScript, JavaScript, YAML, or JSON. Same typed schema
							underneath. Invalid configs fail before bedrock reaches the API.
						</p>
					</div>
					<div class="feature">
						<div class="feature-glyph gl-diamond"><span /><span /></div>
						<div class="feature-num">&rarr; 02</div>
						<h3><code>Result</code>, not throws</h3>
						<p>
							Every public function returns <code>Result&lt;T, E&gt;</code>. Failures show
							up as values to branch on, not exceptions to catch.
						</p>
					</div>
					<div class="feature">
						<div class="feature-glyph gl-stack"><span /><span /><span /><span /></div>
						<div class="feature-num">&rarr; 03</div>
						<h3>State on your terms</h3>
						<p>
							Store state in a GitHub Gist with just a <code>GITHUB_TOKEN</code>.
							S3 is on the way.
						</p>
					</div>
					<div class="feature">
						<div class="feature-glyph gl-pair"><span /><span /></div>
						<div class="feature-num">&rarr; 04</div>
						<h3>Bring your <code>mantle.yaml</code></h3>
						<p>
							Run <code>bedrock migrate ./mantle.yaml</code>. You get a Bedrock config
							back, with unsupported features flagged. Diff before you deploy.
						</p>
					</div>
				</div>
			</div>
		</section>

		<section id="install" class="install">
			<div class="wrap install-grid">
				<div class="install-copy">
					<div class="eyebrow">03 &middot; Quickstart</div>
					<h2>Five minutes, <em>one</em> deploy.</h2>
					<p>
						Install the package, point it at a universe, run <code>deploy</code>. Bedrock
						plans before it touches anything, you always see the diff first.
					</p>
					<ol class="install-steps">
						<li>
							<div>
								<b>Install</b><code>pnpm add bedrock</code> (or <code>npm</code> /
								<code>bun</code> / <code>yarn</code>)
							</div>
						</li>
						<li>
							<div>
								<b>Authenticate</b>Export <code>ROBLOX_API_KEY</code> from an Open Cloud
								key with write scopes.
							</div>
						</li>
						<li>
							<div>
								<b>Scaffold</b>Run <code>bedrock init</code>, pick TS, YAML, or JSON.
							</div>
						</li>
						<li>
							<div>
								<b>Plan</b><code>bedrock diff</code> shows what'll change before anything moves.
							</div>
						</li>
						<li>
							<div>
								<b>Apply</b><code>bedrock deploy</code> reconciles. Rerun any time; nothing
								unchanged is touched.
							</div>
						</li>
					</ol>
				</div>

				<div class="terminal">
					<div class="term-head">
						<div class="term-lights"><span /><span /><span /></div>
						<span>~/strata</span>
						<div class="term-tabs" role="tablist" aria-label="CLI command">
							<button
								v-for="(term, index) in TERM_IDS"
								:id="`term-tab-${term}`"
								:key="term"
								role="tab"
								type="button"
								:class="['term-tab', { active: activeTerm === term }]"
								:aria-selected="activeTerm === term"
								:aria-controls="`term-panel-${term}`"
								:tabindex="activeTerm === term ? 0 : -1"
								@click="activeTerm = term"
								@keydown="navigateTerminalTab($event, index)"
							>
								{{ term }}
							</button>
						</div>
					</div>
					<div class="term-body">
						<div
							v-show="activeTerm === 'diff'"
							id="term-panel-diff"
							role="tabpanel"
							aria-labelledby="term-tab-diff"
							tabindex="0"
							class="term-pane"
						>
							<div><span class="term-prompt">$</span> bedrock diff</div>
							<div class="term-dim">Loading bedrock.config.ts ...</div>
							<div class="term-dim">Fetching current state (gist:bedrock-state) ...</div>
							<div>&nbsp;</div>
							<div>Plan:<span class="term-dim"> 4 to change</span></div>
							<div>  <span class="term-plus">+ create</span>   gamePass.vip-pass      <span class="term-dim">(new)</span></div>
							<div>  <span class="term-warn">~ update</span>   gamePass.early-access  <span class="term-dim">(price: 300 -> 250)</span></div>
							<div>  <span class="term-warn">~ update</span>   experience.config      <span class="term-dim">(3 fields)</span></div>
							<div>  <span class="term-dim">. noop</span>     product.coins_100</div>
							<div>&nbsp;</div>
							<div class="term-dim">No changes will be applied. Run `bedrock deploy` to reconcile.</div>
						</div>

						<div
							v-show="activeTerm === 'deploy'"
							id="term-panel-deploy"
							role="tabpanel"
							aria-labelledby="term-tab-deploy"
							tabindex="0"
							class="term-pane"
						>
							<div><span class="term-prompt">$</span> bedrock deploy</div>
							<div class="term-dim">Plan shown above. Apply? [y/N]</div>
							<div><span class="term-prompt">y</span></div>
							<div>&nbsp;</div>
							<div><span class="term-ok">v</span> gamePass.vip-pass       <span class="term-dim">created (id 987654321)</span></div>
							<div><span class="term-ok">v</span> gamePass.early-access   <span class="term-dim">price updated</span></div>
							<div><span class="term-ok">v</span> experience.config       <span class="term-dim">3 fields</span></div>
							<div class="term-dim">. product.coins_100         unchanged</div>
							<div>&nbsp;</div>
							<div><span class="term-ok">Succeeded</span> in 4.1s <span class="term-dim">1 create, 2 update, 1 noop</span></div>
							<div class="term-dim">State written to gist:bedrock-state</div>
						</div>

						<div
							v-show="activeTerm === 'migrate'"
							id="term-panel-migrate"
							role="tabpanel"
							aria-labelledby="term-tab-migrate"
							tabindex="0"
							class="term-pane"
						>
							<div><span class="term-prompt">$</span> bedrock migrate ./mantle.yaml</div>
							<div class="term-dim">Reading Mantle config ...</div>
							<div>&nbsp;</div>
							<div><span class="term-ok">v</span> experience       <span class="term-dim">mapped</span></div>
							<div><span class="term-ok">v</span> 3 game passes   <span class="term-dim">mapped</span></div>
							<div><span class="term-warn">!</span> social-link     <span class="term-dim">unsupported in Open Cloud, skipped</span></div>
							<div><span class="term-warn">!</span> badge.welcome   <span class="term-dim">deferred to v1.0</span></div>
							<div>&nbsp;</div>
							<div><span class="term-dim">Wrote</span> bedrock.config.ts</div>
							<div><span class="term-dim">Next:</span> bedrock diff</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<section id="ecosystem" class="ecosystem">
			<div class="strata" aria-hidden="true">
				<div class="band" style="top: 20%" />
				<div class="band" style="top: 52%" />
				<div class="band" style="top: 82%" />
			</div>
			<div class="wrap">
				<div class="eco-head">
					<div>
						<div class="eyebrow on-dark">04 &middot; The stack</div>
						<h2>Two layers. <em>One</em> foundation.</h2>
					</div>
					<p>
						Bedrock sits on <code>@bedrock-rbx/ocale</code>, the typed Open Cloud SDK. Use
						Bedrock for declarative deploys, or drop down to Ocale for one-off API calls.
						Same types. Same error model.
					</p>
				</div>

				<div class="eco-stack">
					<div class="eco-layer">
						<div>
							<div class="name">Bedrock</div>
							<div class="role">Declarative &middot; reconciler</div>
						</div>
						<div class="desc">
							The IaC surface. Takes your <code>defineConfig</code>, computes a plan,
							applies it through drivers. CLI and library, same API.
						</div>
						<a class="link" href="/bedrock/guide/getting-started">
							/bedrock/guide
							<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
								<path
									d="M2 6H10M10 6L6.5 2.5M10 6L6.5 9.5"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
								/>
							</svg>
						</a>
					</div>

					<div class="eco-connector" />

					<div class="eco-layer">
						<div>
							<div class="name">Ocale</div>
							<div class="role">Imperative &middot; Open Cloud SDK</div>
						</div>
						<div class="desc">
							Typed clients for Open Cloud resources. Every method returns
							<code>Result&lt;T, OpenCloudError&gt;</code>. Use it directly when you want
							imperative control.
						</div>
						<a class="link" href="/ocale/guide/getting-started">
							/ocale/guide
							<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
								<path
									d="M2 6H10M10 6L6.5 2.5M10 6L6.5 9.5"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
								/>
							</svg>
						</a>
					</div>

					<div class="eco-connector" />

					<div class="eco-layer eco-layer-base">
						<div>
							<div class="name">Open Cloud</div>
							<div class="role">Roblox &middot; platform API</div>
						</div>
						<div class="desc">
							The bedrock under the bedrock. The only supported auth surface, no
							ROBLOSECURITY, by design.
						</div>
						<span class="link link-disabled">roblox.com/open-cloud</span>
					</div>
				</div>
			</div>
		</section>

		<section class="cta-band">
			<div class="wrap">
				<div class="cta-inner">
					<div class="eyebrow eyebrow-center">Ready when you are</div>
					<h2>Build on <em>solid ground.</em></h2>
					<p>
						Install the package, wire up an API key, ship your first deploy, all from
						your terminal, in under five minutes.
					</p>
					<div class="cta-ctas">
						<a class="btn btn-accent" href="/bedrock/guide/getting-started">
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
						<a class="btn btn-ghost" href="https://github.com/christopher-buss/bedrock">
							View on GitHub
						</a>
					</div>
					<div class="cta-snippet-row">
						<span class="cta-snippet">
							<span class="dollar">$</span>
							{{ INSTALL_COMMAND }}
							<button
								:class="['copy', { 'copy-done': copyState === 'copied' }]"
								type="button"
								aria-label="Copy install command"
								@click="copyInstall"
							>
								{{ copyState === "copied" ? "copied" : "copy" }}
							</button>
						</span>
					</div>
				</div>
			</div>
		</section>

		<footer class="bedrock-foot">
			<div class="wrap">
				<div class="foot">
					<div class="foot-brand">
						<a class="brand" href="#">
							<span class="brand-mark">
								<span /><span /><span /><span />
							</span>
							Bedrock
						</a>
						<p>
							Infrastructure-as-Code for Roblox. Typed, Open-Cloud-only, built for
							studios that ship.
						</p>
					</div>
					<div>
						<h5>Bedrock</h5>
						<ul>
							<li><a href="/bedrock/guide/getting-started">Getting started</a></li>
							<li><a href="#">Configuration</a></li>
							<li><a href="#">CLI reference</a></li>
							<li><a href="#">Migration from Mantle</a></li>
						</ul>
					</div>
					<div>
						<h5>Ocale</h5>
						<ul>
							<li><a href="/ocale/guide/getting-started">Getting started</a></li>
							<li><a href="#">Resource clients</a></li>
							<li><a href="/ocale/guide/errors">Error hierarchy</a></li>
						</ul>
					</div>
					<div>
						<h5>Project</h5>
						<ul>
							<li><a href="https://github.com/christopher-buss/bedrock">GitHub</a></li>
							<li><a href="#">Roadmap</a></li>
							<li><a href="#">ADRs</a></li>
							<li><a href="#">Changelog</a></li>
						</ul>
					</div>
				</div>
				<div class="foot-bottom">
					<div>&copy; 2026 &middot; MIT Licensed &middot; {{ VERSION }}</div>
					<div>built with vitepress</div>
				</div>
			</div>
		</footer>
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

	--accent: #5944a2;
	--accent-soft: #a8bdd8;
	--accent-deep: #324a6e;
	--accent-bg: #e4ebf5;
	--accent-em: var(--accent-deep);

	--ok: #4a8a64;

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Source Serif 4", "Times New Roman", serif;
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

	--accent: #5944a2;
	--accent-soft: #b8c9e0;
	--accent-deep: #4e6c92;
	--accent-bg: #1e2840;
	--accent-em: var(--accent-soft);
}

.bedrock-landing,
.bedrock-landing .bedrock-nav,
.bedrock-landing .hero {
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-landing section[id] {
	scroll-margin-top: 76px;
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
	background: #6553aa;
	color: #fff;
}

.btn-accent:hover {
	background: color-mix(in oklch, #6553aa, #fff 8%);
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

/* Hero shell, always dark per the design (the "stratum") */
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

/* Shiki output styling (via :deep since v-html bypasses scoped CSS) */
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

/* Tracks section */
.tracks {
	padding: 110px 0 100px;
	border-top: 1px solid var(--line);
}

.tracks-head {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 72px;
	align-items: end;
	margin-bottom: 56px;
}

.tracks-head h2 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(40px, 4.6vw, 60px);
	line-height: 1.02;
	letter-spacing: -0.02em;
	margin: 14px 0 0;
	max-width: 16ch;
}

.tracks-head h2 em {
	font-style: italic;
	color: var(--accent-em);
}

.tracks-head p {
	font-size: 16px;
	color: var(--ink-3);
	max-width: 46ch;
	margin: 0;
	align-self: end;
	line-height: 1.55;
}

.tracks-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 24px;
}

.track {
	background: var(--bg-card);
	border: 1px solid var(--line);
	border-radius: var(--r-lg);
	padding: 32px 32px 28px;
	position: relative;
	transition: border-color 0.2s var(--ease);
}

.track:hover {
	border-color: var(--line-strong);
}

.track .tag {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--ink-3);
	margin-bottom: 16px;
}

.track .tag::before {
	content: "";
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--accent);
}

.track h3 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: 34px;
	letter-spacing: -0.015em;
	margin: 0 0 8px;
	line-height: 1.05;
}

.track h3 em {
	font-style: italic;
	color: var(--accent-em);
}

.track p.lede {
	font-size: 15px;
	color: var(--ink-3);
	margin: 0 0 22px;
	line-height: 1.55;
	max-width: 42ch;
}

.track p.lede code {
	font-family: var(--f-mono);
	font-size: 13px;
	color: var(--ink-2);
	background: var(--bg-soft);
	padding: 1px 5px;
	border-radius: 3px;
}

.track-code {
	background: var(--dark-bg);
	color: var(--dark-ink-2);
	border-radius: var(--r);
	padding: 18px 20px;
	font-family: var(--f-mono);
	font-size: 12.5px;
	line-height: 1.65;
	overflow-x: auto;
	border: 1px solid var(--dark-line);
	margin: 0;
}

.track-code .prompt {
	color: var(--accent-soft);
}

.track-code .dim {
	color: var(--dark-ink-3);
}

.track-code-shiki {
	background: var(--dark-bg);
	border-radius: var(--r);
	border: 1px solid var(--dark-line);
	overflow: hidden;
}

.track-code-shiki :deep(pre.shiki) {
	margin: 0;
	padding: 18px 20px;
	background: transparent !important;
	font-family: var(--f-mono);
	font-size: 12.5px;
	line-height: 1.65;
	tab-size: 4;
	-moz-tab-size: 4;
	overflow-x: auto;
}

.track-code-shiki :deep(pre.shiki code) {
	background: transparent;
}

.track-note {
	margin-top: 18px;
	font-family: var(--f-mono);
	font-size: 11.5px;
	color: var(--ink-4);
	letter-spacing: 0.02em;
}

.track-note b {
	color: var(--ink-2);
	font-weight: 500;
}

/* Features section */
.features {
	padding: 110px 0;
	border-bottom: 1px solid var(--line);
}

.features-head {
	display: flex;
	justify-content: space-between;
	align-items: end;
	margin-bottom: 56px;
	gap: 48px;
}

.features-head h2 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(40px, 4.6vw, 54px);
	line-height: 1.02;
	letter-spacing: -0.02em;
	margin: 14px 0 0;
	max-width: 15ch;
}

.features-head p {
	font-size: 16px;
	color: var(--ink-3);
	max-width: 42ch;
	margin: 0;
}

.feature-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 1px;
	background: var(--line);
	border: 1px solid var(--line);
	border-radius: var(--r-lg);
	overflow: hidden;
}

.feature {
	background: var(--bg-card);
	padding: 32px 28px 36px;
	min-height: 240px;
	transition: background 0.15s var(--ease);
	display: flex;
	flex-direction: column;
}

.feature:hover {
	background: color-mix(in oklch, var(--bg-card), var(--accent) 4%);
}

.feature-num {
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--ink-4);
	letter-spacing: 0.1em;
	margin-bottom: 22px;
}

.feature-glyph {
	width: 40px;
	height: 28px;
	margin-bottom: 20px;
	display: flex;
	align-items: flex-end;
	gap: 2px;
}

.feature-glyph span {
	background: var(--ink);
	border-radius: 1px;
	display: block;
}

.feature-glyph span:last-child {
	background: var(--accent);
}

.gl-stack span {
	width: 7px;
}

.gl-stack span:nth-child(1) {
	height: 8px;
	opacity: 0.3;
}

.gl-stack span:nth-child(2) {
	height: 14px;
	opacity: 0.55;
}

.gl-stack span:nth-child(3) {
	height: 22px;
	opacity: 0.75;
}

.gl-stack span:nth-child(4) {
	height: 28px;
}

.gl-pair span {
	width: 13px;
}

.gl-pair span:nth-child(1) {
	height: 20px;
	opacity: 0.4;
}

.gl-pair span:nth-child(2) {
	height: 28px;
}

.gl-line {
	align-items: center;
}

.gl-line span {
	height: 2px;
	border-radius: 1px;
}

.gl-line span:nth-child(1) {
	width: 18px;
	opacity: 0.3;
}

.gl-line span:nth-child(2) {
	width: 26px;
	opacity: 0.6;
}

.gl-line span:nth-child(3) {
	width: 12px;
}

.gl-dots {
	align-items: center;
}

.gl-dots span {
	width: 7px;
	height: 7px;
	border-radius: 50%;
}

.gl-dots span:nth-child(1) {
	opacity: 0.35;
}

.gl-dots span:nth-child(2) {
	opacity: 0.6;
}

.gl-dots span:nth-child(3) {
	opacity: 0.85;
}

.gl-diamond {
	align-items: center;
	justify-content: center;
}

.gl-diamond span {
	width: 14px;
	height: 14px;
	transform: rotate(45deg);
}

.gl-diamond span:nth-child(1) {
	opacity: 0.35;
}

.gl-grid {
	flex-wrap: wrap;
	width: 28px;
	height: 28px;
	gap: 2px;
}

.gl-grid span {
	width: 12px;
	height: 12px;
	opacity: 0.35;
}

.gl-grid span:last-child {
	opacity: 1;
}

.feature h3 {
	font-family: var(--f-sans);
	font-size: 17px;
	font-weight: 600;
	margin: 0 0 8px;
	letter-spacing: -0.01em;
}

.feature h3 code {
	font-family: var(--f-mono);
	font-size: 14px;
	color: var(--ink);
	background: var(--bg-soft);
	padding: 1px 5px;
	border-radius: 3px;
}

.feature p {
	margin: 0;
	font-size: 14.5px;
	color: var(--ink-3);
	line-height: 1.55;
}

.feature p code {
	background: var(--bg-soft);
	padding: 1px 5px;
	border-radius: 3px;
	font-size: 12.5px;
	color: var(--ink-2);
}

.features-head h2 em {
	font-style: italic;
	color: var(--accent-em);
}

/* Quickstart / install section */
.install {
	padding: 110px 0;
	background: var(--bg-soft);
	border-bottom: 1px solid var(--line);
}

.install-grid {
	display: grid;
	grid-template-columns: 1fr 1.2fr;
	gap: 72px;
	align-items: start;
}

.install-copy h2 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(40px, 4.6vw, 54px);
	line-height: 1.02;
	letter-spacing: -0.02em;
	margin: 14px 0 16px;
}

.install-copy h2 em {
	font-style: italic;
	color: var(--accent-em);
}

.install-copy p {
	font-size: 16px;
	color: var(--ink-2);
	margin: 0 0 24px;
	max-width: 42ch;
	line-height: 1.55;
}

.install-copy p code {
	font-family: var(--f-mono);
	font-size: 14px;
	color: var(--ink-2);
	background: var(--bg-card);
	padding: 1px 5px;
	border-radius: 3px;
	border: 1px solid var(--line);
}

.install-steps {
	list-style: none;
	padding: 0;
	margin: 0;
	counter-reset: step;
}

.install-steps li {
	display: flex;
	gap: 14px;
	padding: 12px 0;
	border-top: 1px solid var(--line);
	font-size: 14.5px;
	color: var(--ink-2);
	counter-increment: step;
}

.install-steps li:last-child {
	border-bottom: 1px solid var(--line);
}

.install-steps li::before {
	content: counter(step, decimal-leading-zero);
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--accent-em);
	letter-spacing: 0.08em;
	min-width: 28px;
	padding-top: 2px;
	font-weight: 500;
}

.install-steps li b {
	color: var(--ink);
	font-weight: 600;
	display: block;
	margin-bottom: 2px;
}

.install-steps li code {
	font-family: var(--f-mono);
	font-size: 12.5px;
	color: var(--ink-2);
	background: var(--bg-card);
	padding: 1px 5px;
	border-radius: 3px;
	border: 1px solid var(--line);
}

.terminal {
	background: var(--dark-bg);
	border: 1px solid var(--dark-line);
	border-radius: var(--r-lg);
	overflow: hidden;
	font-family: var(--f-mono);
	font-size: 12.5px;
	box-shadow: 0 18px 56px -20px rgba(0, 0, 0, 0.35);
}

.term-head {
	padding: 11px 14px;
	border-bottom: 1px solid var(--dark-line);
	display: flex;
	align-items: center;
	gap: 10px;
	color: var(--dark-ink-3);
	font-size: 12px;
}

.term-lights {
	display: flex;
	gap: 6px;
	margin-right: 8px;
}

.term-lights span {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: var(--dark-line);
}

.term-tabs {
	margin-left: auto;
	display: flex;
	gap: 2px;
}

.term-tab {
	padding: 4px 10px;
	font-size: 11px;
	color: var(--dark-ink-3);
	border-radius: 4px;
	transition: all 0.15s var(--ease);
}

.term-tab.active {
	background: rgba(255, 255, 255, 0.05);
	color: var(--dark-ink);
}

.term-body {
	padding: 20px;
	color: var(--dark-ink-2);
	line-height: 1.75;
	max-height: 440px;
	overflow-y: auto;
}

.term-pane > div {
	white-space: pre;
}

.term-prompt {
	color: var(--accent-soft);
}

.term-dim {
	color: var(--dark-ink-3);
}

.term-ok {
	color: #9dc18a;
}

.term-warn {
	color: #e6b472;
}

.term-plus {
	color: #9dc18a;
}

/* Ecosystem section */
.ecosystem {
	padding: 120px 0;
	background: var(--dark-bg);
	color: var(--dark-ink);
	border-bottom: 1px solid var(--dark-line);
	position: relative;
	overflow: hidden;
}

.ecosystem .strata {
	position: absolute;
	inset: 0;
	opacity: 0.4;
	pointer-events: none;
}

.ecosystem .strata .band {
	position: absolute;
	left: 0;
	right: 0;
	border-top: 1px solid var(--dark-line);
}

.eco-head {
	position: relative;
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 72px;
	margin-bottom: 56px;
}

.eco-head h2 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(40px, 4.6vw, 60px);
	line-height: 1.02;
	letter-spacing: -0.02em;
	margin: 14px 0 0;
	color: var(--dark-ink);
}

.eco-head h2 em {
	font-style: italic;
	color: var(--accent-soft);
}

.eco-head p {
	color: var(--dark-ink-2);
	font-size: 16px;
	margin: 0;
	max-width: 46ch;
	line-height: 1.55;
	align-self: end;
}

.eco-head p code {
	color: var(--accent-soft);
	background: rgba(255, 255, 255, 0.05);
	padding: 1px 6px;
	border-radius: 3px;
	font-family: var(--f-mono);
	font-size: 14px;
}

.eco-stack {
	position: relative;
	display: grid;
	gap: 14px;
	max-width: 820px;
	margin: 0 auto;
}

.eco-layer {
	background: var(--dark-bg-2);
	border: 1px solid var(--dark-line);
	border-radius: var(--r-lg);
	padding: 28px 32px;
	display: grid;
	grid-template-columns: 220px 1fr auto;
	gap: 32px;
	align-items: center;
	transition: all 0.2s var(--ease);
}

.eco-layer:hover {
	border-color: color-mix(in oklch, var(--accent) 45%, var(--dark-line));
	transform: translateX(4px);
}

.eco-layer-base {
	opacity: 0.78;
}

.eco-layer-base:hover {
	transform: none;
	border-color: var(--dark-line);
}

.eco-layer .name {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: 32px;
	letter-spacing: -0.015em;
	color: var(--dark-ink);
	display: flex;
	align-items: center;
	gap: 12px;
}

.eco-layer .name::before {
	content: "";
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--accent);
}

.eco-layer-base .name {
	color: var(--dark-ink-3);
}

.eco-layer-base .name::before {
	background: var(--dark-ink-3);
}

.eco-layer .role {
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--dark-ink-3);
	margin-top: 4px;
}

.eco-layer .desc {
	font-size: 14.5px;
	color: var(--dark-ink-2);
	line-height: 1.55;
	max-width: 52ch;
}

.eco-layer-base .desc {
	color: var(--dark-ink-3);
}

.eco-layer .desc code {
	color: var(--accent-soft);
	background: rgba(255, 255, 255, 0.05);
	padding: 1px 6px;
	border-radius: 3px;
	font-family: var(--f-mono);
	font-size: 13px;
}

.eco-layer a.link {
	font-family: var(--f-mono);
	font-size: 12px;
	color: var(--accent-soft);
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 8px 14px;
	border: 1px solid var(--dark-line);
	border-radius: 999px;
	transition: all 0.15s var(--ease);
}

.eco-layer a.link:hover {
	border-color: var(--accent-soft);
	background: rgba(230, 180, 114, 0.06);
}

.eco-layer .link-disabled {
	font-family: var(--f-mono);
	font-size: 12px;
	color: var(--dark-ink-3);
	white-space: nowrap;
	padding: 8px 14px;
}

.eco-connector {
	height: 18px;
	width: 1px;
	background: var(--dark-line);
	justify-self: center;
}

/* CTA band */
.cta-band {
	padding: 120px 0;
	text-align: center;
	background: repeating-linear-gradient(
		180deg,
		transparent 0 39px,
		var(--line) 39px 40px
	);
}

.cta-inner {
	background: var(--bg);
	padding: 64px 40px;
	border: 1px solid var(--line);
	border-radius: var(--r-lg);
	max-width: 760px;
	margin: 0 auto;
}

.eyebrow-center {
	justify-content: center;
}

.eyebrow-center::after {
	content: "";
	width: 18px;
	height: 1px;
	background: currentColor;
}

.cta-inner h2 {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: clamp(44px, 5vw, 64px);
	line-height: 1.02;
	letter-spacing: -0.02em;
	margin: 18px 0 16px;
}

.cta-inner h2 em {
	font-style: italic;
	color: var(--accent-em);
}

.cta-inner p {
	color: var(--ink-3);
	font-size: 17px;
	margin: 0 auto 32px;
	max-width: 44ch;
}

.cta-ctas {
	display: flex;
	gap: 10px;
	justify-content: center;
	flex-wrap: wrap;
}

.btn-ghost {
	border-color: var(--line-strong);
	color: var(--ink-2);
}

.btn-ghost:hover {
	border-color: var(--ink);
	color: var(--ink);
}

.cta-snippet-row {
	margin-top: 28px;
}

.cta-snippet {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px 10px 16px;
	background: var(--bg-card);
	border: 1px solid var(--line);
	border-radius: 999px;
	font-family: var(--f-mono);
	font-size: 13px;
	color: var(--ink-2);
}

.cta-snippet .dollar {
	color: var(--ink-4);
}

.cta-snippet .copy {
	padding: 4px 10px;
	font-family: var(--f-mono);
	font-size: 11px;
	border-radius: 999px;
	background: var(--bg-soft);
	color: var(--ink-3);
	transition: all 0.15s var(--ease);
}

.cta-snippet .copy:hover {
	background: var(--ink);
	color: var(--bg);
}

.cta-snippet .copy-done,
.cta-snippet .copy-done:hover {
	background: color-mix(in oklch, var(--ok), var(--bg) 78%);
	color: var(--ok);
	cursor: default;
}

/* Footer */
.bedrock-foot {
	padding: 72px 0 48px;
	background: var(--bg-soft);
	border-top: 1px solid var(--line);
}

.foot {
	display: grid;
	grid-template-columns: 1.4fr 1fr 1fr 1fr;
	gap: 48px;
	margin-bottom: 56px;
}

.foot h5 {
	font-family: var(--f-mono);
	font-size: 11px;
	font-weight: 500;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-3);
	margin: 0 0 16px;
}

.foot ul {
	list-style: none;
	padding: 0;
	margin: 0;
}

.foot li {
	margin-bottom: 10px;
}

.foot a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.foot a:hover {
	color: var(--ink);
}

.foot-brand p {
	font-size: 14px;
	color: var(--ink-3);
	max-width: 34ch;
	margin: 14px 0 0;
	line-height: 1.55;
}

.foot-bottom {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding-top: 28px;
	border-top: 1px solid var(--line);
	font-size: 12px;
	color: var(--ink-4);
	font-family: var(--f-mono);
}

/* Responsive */
@media (max-width: 960px) {
	.hero-inner,
	.tracks-head,
	.tracks-grid,
	.eco-head,
	.install-grid,
	.foot {
		grid-template-columns: 1fr;
		gap: 40px;
	}

	.features-head {
		flex-direction: column;
		align-items: start;
	}

	.feature-grid {
		grid-template-columns: 1fr 1fr;
	}

	.nav-links {
		display: none;
	}

	.eco-layer {
		grid-template-columns: 1fr;
		gap: 14px;
	}

	.eco-layer a.link {
		justify-self: start;
	}
}

@media (max-width: 640px) {
	.wrap {
		padding: 0 20px;
	}

	.feature-grid {
		grid-template-columns: 1fr;
	}

	.bedrock-landing .hero-inner {
		padding: 56px 16px 64px;
	}

	.tracks,
	.features,
	.install,
	.ecosystem,
	.cta-band {
		padding: 72px 0;
	}
}
</style>
