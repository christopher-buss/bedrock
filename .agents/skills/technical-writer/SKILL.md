---
name: technical-writer
description: Craft rules for technical documentation prose — structure, voice, headings, steps, tables, callouts, and forbidden filler. Use when writing, reviewing, or revising developer docs (guides, tutorials, how-tos, reference, concept pages, READMEs). Pairs with the diataxis skill: diataxis decides *what kind* of page this is, this skill governs *how each sentence lands*.
---

# Technical writing craft rules

Apply these rules when producing or editing developer documentation prose. Follows the spirit of the Google Developer Documentation Style Guide without being tied to any one brand guide. Complements the Diátaxis framework: Diátaxis tells you which quadrant (tutorial, how-to, reference, explanation) a page belongs to; these rules tell you how to write each sentence once the quadrant is fixed.

## When to apply

Trigger when the user is:

- Writing a new docs page (tutorial, how-to, reference entry, explanation, getting-started, README, migration guide).
- Reviewing or revising an existing docs page for quality.
- Diagnosing why a docs page feels flat, bloated, or confusing.

Skip for: commit messages, PR descriptions, ADRs, internal design docs, code comments. Those have their own registers.

## Structure rules

1. **Open with a one-sentence summary.** The first line must tell the reader what they will learn or accomplish. If removing the opening sentence leaves the page's purpose unclear, it was doing work.
2. **H2 sections as scannable signposts.** Each heading is a promise: the reader should know what they'll get from the section without reading it. Prefer verb-led headings for task pages, noun phrases for reference.
3. **Order by frequency, not logic.** Most common use case first, edge cases last. A reader who stops reading halfway should still have hit the 80% path.
4. **Inverted pyramid within each section.** Lead with the most important sentence. Supporting detail follows. Caveats and edge cases end the section.
5. **One topic per H2.** If a section covers two things, split it. Skim readers rely on the heading matching the content.

## Voice and register

- **Active voice, present tense.** "Bedrock reads the config" beats "The config is read by bedrock." Passive is acceptable only when the agent genuinely doesn't matter.
- **Second person for instructions** ("you configure"), **third person for concepts** ("bedrock configures"). Do not mix within a section.
- **Sentence case headings.** Proper nouns keep their capitals.
- **Concrete over abstract.** Name the file, the function, the command. "Run `pnpm build`" beats "build the project."
- **No filler openers.** Cut "In order to", "It is important to note that", "Please note that", "Basically".

## Procedural steps

- **One imperative verb per step.** "Install the dependency." not "You should now install the dependency, which you can do by..."
- **One action per step.** If a step contains "and then", split it.
- **State the expected result.** Each step ends with what the reader should see or verify. "Run `pnpm test`. All tests should pass."
- **Warnings before the action, never after.** "Before dropping the table, back up the database" not "Drop the table. (Note: back up first.)"
- **Link prerequisites, don't restate them.** A how-to guide assumes competence — point to the tutorial instead of re-teaching.

## Tables, callouts, code

- **Tables for structured comparisons.** Use when three or more items share three or more attributes. Prose wins for two items or two attributes.
- **Callouts (note, warning, tip) sparingly.** Reserve for data loss, security, or non-obvious gotchas. If every other paragraph has a callout, none of them get read.
- **Complete, runnable code examples.** Every fenced block specifies a language. Every example includes imports, is copy-pasteable, and shows expected output where it clarifies intent.
- **Relative links within the site.** External links open in a new tab only if the target is not part of the docs.

## Forbidden phrases

Scan every draft for these. They almost always hide writer uncertainty or condescension:

- `simply` / `just` / `easy` / `easily` / `obviously` / `of course` / `clearly`
- `basically` / `essentially` / `actually`
- `please note that` / `it should be noted that` / `as you can see`
- `(s)` for plurals (write "one or more Xs" or pluralize)
- Filler "very" / "really" / "quite"

When in doubt: delete the word, reread the sentence. If nothing is lost, leave it out.

## Terminology hygiene

- **Define acronyms on first use.** "Infrastructure as Code (IaC)" once, then "IaC".
- **Consistent terms within and across pages.** Pick one of {config, configuration, settings} per domain. A glossary entry for every domain-specific term.
- **No novelty synonyms.** If the repo calls it a "resource", don't call it a "component" on alternating paragraphs.

## Verification before publishing

1. **Follow the instructions on a clean environment.** Every procedural step must execute as written with no tacit knowledge.
2. **Every code block compiles and runs.** Test each one in isolation.
3. **Every internal link resolves.** Run the site's link checker or build with strict mode.
4. **Novice read-through.** Hand the page to someone unfamiliar with the feature. If they can't complete the task, the page has a gap.
5. **Read the headings in sequence.** If the TOC alone tells the story, the structure works. If not, restructure.

## Quick review checklist

Scan any draft against these. Any unchecked item is a revision target:

- [ ] One-sentence summary in the first line
- [ ] Each H2 is a promise the section keeps
- [ ] Most common path first, edge cases last
- [ ] Active voice, present tense
- [ ] Steps are single imperatives with expected results
- [ ] No filler openers, no forbidden phrases
- [ ] Code blocks runnable, languages tagged
- [ ] Consistent terminology throughout
- [ ] Internal links relative and resolving
