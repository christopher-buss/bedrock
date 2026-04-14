---
description: Create a git commit following project standards
argument-hint: [optional-commit-description]
---

Create a git commit following project standards

Include any of the following info if specified: $ARGUMENTS

## Commit Message Rules

Follows [Conventional Commits](https://www.conventionalcommits.org/) standard.

1. **Format**: `type(scope): description`
    - Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`,
      `style`, `ci`
    - Scope: The primary package/module effected (e.g., `cli`, `ocale`,
      `website`).
    - Description: Brief summary of changes (max 72 characters), always
      lowercase, no period at end. Split PascalCase with hyphens (e.g.,
      `Add UserAuth` -> `add user-auth`).

2. **Content**: Write clear, concise commit messages describing what changed and
   why. Use imperative mood (e.g., "Add feature" not "Added feature" or "Adds
   feature").

## Process

1. Run `git status` and `git diff` to review changes
2. Run `git log --oneline -5` to see recent commit style
3. Stage relevant files with `git add`
4. Create commit with descriptive message
5. Verify with `git status`

## Example

```bash
git add <files>
git commit -m "feat(open-cloud): add support for game icon uploads

This adds the ability for users to upload custom icons for their games.

Closes #123
"
```
