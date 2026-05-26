# Release Process

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| **Build Docker Image** | Manual (GitHub UI) | Builds and pushes `:latest` + `:sha-xxx` — for testing a snapshot |
| **Release Docker Image** | Manual (GitHub UI) | Creates a git tag and publishes versioned images to GHCR |

---

TSandbox follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Change type | Version bump | Example |
|---|---|---|
| Breaking API or config change | Major | `1.0.0` → `2.0.0` |
| New feature, backwards-compatible | Minor | `1.0.0` → `1.1.0` |
| Bug fix, docs, dependency update | Patch | `1.0.0` → `1.0.1` |

---

## Cutting a Release

### 1. Update the changelog

In `CHANGELOG.md`, rename `[Unreleased]` to the new version and date, then add a fresh empty `[Unreleased]` section at the top:

```markdown
## [Unreleased]

## [1.1.0] - 2026-06-01

### Added
- ...

### Fixed
- ...
```

Update the comparison links at the bottom of the file:

```markdown
[Unreleased]: https://github.com/khang7598/TSandbox/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/khang7598/TSandbox/compare/v1.0.0...v1.1.0
```

### 2. Commit

```bash
git add CHANGELOG.md
git commit -m "chore: release v1.1.0"
```

### 3. Push to main

```bash
git push origin main
```

### 4. Trigger the release workflow

Go to **GitHub → Actions → Release Docker Image → Run workflow**, enter the version (e.g. `1.1.0`), and click **Run workflow**.

The workflow will automatically:
- Create and push the `v1.1.0` git tag
- Build the Docker image
- Publish `ghcr.io/khang7598/tsandbox:1.1.0`
- Publish `ghcr.io/khang7598/tsandbox:1.1`
- Update `ghcr.io/khang7598/tsandbox:latest`

### 5. Create a GitHub Release (optional)

```bash
gh release create v1.1.0 --title "v1.1.0" --notes-from-tag
```

Or go to **GitHub → Releases → Draft a new release**, select the tag, and paste the changelog section as the description.

---

## Hotfix Process

For an urgent fix on a released version:

```bash
# Branch from the tag
git checkout -b hotfix/v1.0.1 v1.0.0

# Make the fix, update CHANGELOG.md, then:
git add .
git commit -m "fix: <description>"
git push origin hotfix/v1.0.1

# Trigger the release from GitHub UI:
# Actions → Release Docker Image → Run workflow → version: 1.0.1

# Merge fix back into main
git checkout main
git merge hotfix/v1.0.1
git push origin main
```

---

## Changelog Entry Categories

Use these section headers (omit any that are empty):

| Section | When to use |
|---|---|
| `Added` | New features |
| `Changed` | Changes to existing behaviour |
| `Deprecated` | Features that will be removed in a future release |
| `Removed` | Features removed in this release |
| `Fixed` | Bug fixes |
| `Security` | Security patches |
