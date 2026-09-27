# Releasing

Releases come from `main`. Every pull request title is a conventional
commit (`feat: ...`, `fix: ...`), which the PR title check enforces, and
merges are squashed so each becomes one commit on `main` with that title.

1. After each merge, release-please opens or updates a pull request named
   "chore(main): release X.Y.Z". It bumps the version in `Cargo.toml`,
   updates `Cargo.lock`, and writes `CHANGELOG.md` from the commits.
   `feat` raises the minor version and `fix` the patch; before 1.0 a
   breaking change (`feat!:`) raises the minor version.
2. Merging that pull request tags `vX.Y.Z` and creates the GitHub release.
3. The release then builds the binaries for six platforms and publishes
   every channel below, plus the Docker images tagged `vX.Y.Z` and `latest`.

Never edit the version or `CHANGELOG.md` by hand. To publish an existing
tag again, run the Release workflow from the Actions tab with that tag.

Every merge to `main` also publishes the Docker images tagged `main`, and
redeploys Dokploy when it is set up (DEPLOY.md).

## One-time setup

Each channel publishes only once its secret or variable is set; until then
the release skips it and says so. Secrets and variables go in this
repository's Settings, Secrets and variables, Actions.

| Channel | What to create | Secret | Variable |
|---|---|---|---|
| Release pull requests | A fine-grained token with Contents and Pull requests (read and write) on this repository. Without it the release PR is opened by the default token, and CI does not run on it. | `RELEASE_TOKEN` | |
| GitHub release, `.deb`, `.rpm`, binaries | Nothing | | |
| Docker images | Nothing. After the first push, make both packages public (DEPLOY.md). | | |
| npm | The `commitscape` package name and the `@commitscape` organisation on npmjs.com, and an automation token | `NPM_TOKEN` | |
| crates.io | An API token with publish rights, from crates.io's account settings | `CARGO_REGISTRY_TOKEN` | |
| Homebrew | A public repository `pixelactstudio/homebrew-commitscape` | `PACKAGES_TOKEN` | `HOMEBREW_TAP=pixelactstudio/homebrew-commitscape` |
| Scoop | A public repository `pixelactstudio/scoop-bucket` | `PACKAGES_TOKEN` | `SCOOP_BUCKET=pixelactstudio/scoop-bucket` |
| winget | A fork of `microsoft/winget-pkgs` under the token's account, and the first version submitted by hand with `wingetcreate new` using the release's `commitscape-win32-x64.zip` | `PACKAGES_TOKEN` | `WINGET_IDENTIFIER=DevTalan.Commitscape` |
| AUR | An account on aur.archlinux.org with an SSH key; the first push creates `commitscape-bin` | `AUR_SSH_PRIVATE_KEY` | `AUR_USERNAME`, `AUR_EMAIL` |
| Sentry source maps | An auth token from Sentry | `SENTRY_AUTH_TOKEN` | `SENTRY_ORG`, `SENTRY_PROJECT` |
| Dokploy | See DEPLOY.md | `DOKPLOY_API_KEY` | `DOKPLOY_URL`, `DOKPLOY_BUILDER_APP_ID`, `DOKPLOY_SITE_APP_ID` |

`PACKAGES_TOKEN` is one classic token with the `public_repo` scope, from
the account that owns the tap, the bucket and the winget fork.

In the repository's settings, allow only squash merging, and use the pull
request title as the commit message.
