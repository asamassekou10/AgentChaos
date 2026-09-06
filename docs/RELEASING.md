# Releasing

Publishing is automated. Creating a GitHub release publishes the package to npm; nothing is published by hand, and no npm token exists in this repository.

## One-time setup

This has to be done once, on npmjs.com, by someone who owns the package. It is not something a workflow can do for you.

1. Sign in at [npmjs.com](https://www.npmjs.com) and open the package page for `agent-chaos`.
2. Go to **Settings** → **Trusted Publisher**.
3. Choose **GitHub Actions** and fill in:

   | Field                | Value           |
   | -------------------- | --------------- |
   | Organization or user | `asamassekou10` |
   | Repository           | `AgentChaos`    |
   | Workflow filename    | `release.yml`   |
   | Environment          | leave empty     |

   The workflow filename is just the file name, not a path.

4. Save.

That is the whole setup. There is no token to generate, copy, or rotate, and nothing to add to GitHub secrets.

### Why trusted publishing rather than a token

An automation token is a long-lived credential sitting in repository secrets. Anyone who can run a workflow, or who compromises an action the workflow depends on, can read it and publish as you. Trusted publishing swaps that for an OIDC token GitHub mints per run, scoped to this repository and this workflow file, valid for minutes. There is nothing to exfiltrate.

It also means npm generates a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) automatically, so the published package can be traced back to the commit and workflow that built it. That is worth having for any package, and particularly for one whose whole argument is that software supply chains deserve checking.

## Cutting a release

```bash
# 1. Start from a clean, green main
git checkout main && git pull
npm run check

# 2. Bump the version. Use the smallest step that is honest about the change.
npm version minor --no-git-tag-version    # or patch / major

# 3. Update the changelog, then commit
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: 0.2.0"
git push origin main

# 4. Tag and create the release. Publishing starts here.
gh release create v0.2.0 --title "AgentChaos 0.2.0" --notes-file release-notes.md
```

The tag must be `v` followed by the exact version in `package.json`. The workflow refuses to publish if they disagree, because a package that does not match its release is worse than no release.

## What the workflow checks before publishing

In order, and any failure stops the publish:

1. **Tag matches `package.json`.** No silent mismatch between what the release says and what npm gets.
2. **The version is not already on npm.** Versions cannot be reused, so this fails loudly rather than producing a confusing registry error.
3. **The full gate.** Format, lint, typecheck, tests, build — the same as every push.
4. **Both demos.** The vulnerable agent must exit 1 and the safe one must exit 0. If the engine stopped reaching the right verdict, that is not a release.
5. **The packed tarball, installed and exercised.** `npm pack`, install into an empty project, then run `--version`, `init`, `list`, and a real scenario against a throwaway agent that must be caught.

Step 5 exists because of a specific near-miss. Version 0.1.0 was packed and nearly published in a state where **every command printed nothing when installed**: npm exposes `bin` as a symlink, the entry-point guard compared `process.argv[1]` to `import.meta.url` without resolving either, and the comparison was false for every installed user. Every test passed. Both demos passed. All of CI was green. Every one of those runs the CLI by its real path from a checkout.

The only thing that caught it was installing the tarball and running it. So that is now a release gate.

## After publishing

The workflow polls the registry until the new version resolves, so a green run means the package is really there. Confirm independently if you like:

```bash
npm view agent-chaos version
```

## If a release fails

The publish step is last, so a failure before it means nothing was published and the release is just a tag. Fix the problem on `main`, delete the release and tag, and cut it again:

```bash
gh release delete v0.2.0 --yes
git push --delete origin v0.2.0
```

If the publish step itself failed after npm accepted the package, the version is gone for good. Bump to the next patch and release that; do not try to reuse the number.

## Versioning

Pre-1.0, so the minor is the breaking-change signal.

- **patch** — a fix that changes no interface
- **minor** — new detectors, scenarios, commands, or config keys; also anything that changes a verdict, since a scenario that starts failing is a breaking change to whoever runs it in CI
- **major** — reserved for 1.0

Changing what a scenario reports is the change most likely to surprise someone, because it turns a green pipeline red. Treat it as at least a minor and say so plainly in the notes.
