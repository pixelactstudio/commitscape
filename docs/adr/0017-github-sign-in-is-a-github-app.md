# GitHub sign-in and private repositories go through one GitHub App, read-only

People sign in to the Site with GitHub through a GitHub App, which also grants access to the repositories they choose. The App asks only for read permissions. The Builder works with installation tokens that last one hour and cover only the chosen repositories. There is no OAuth App and no `repo` scope.

## Status

accepted (2026-09-25, Build Run 4 plan). Extends ADR-0009 to the Site. The local binary still asks GitHub only through `gh`.

## Context

The owner wants a "Your repositories" page: sign in, see your repositories, click one, see its Report. An OAuth App would need the `repo` scope for private repositories. That scope grants read **and write** access to every repository the user can reach, organisations included. A leaked database of such tokens would be a disaster, and publishing the source doesn't change what the tokens can do.

A GitHub App grants the following:
- **Per repository:** the user picks which repositories on GitHub's own screen.
- **Per permission:** read-only.
- **Short-lived tokens:** installation tokens last an hour, and user tokens expire and refresh.
- **Rate limits** that grow with installations.

## Decision

- **Permissions:** Metadata read, Contents read, Pull requests read, Issues read. Nothing else, and nothing with write.
- **Sign-in** uses the App's user authorization (OAuth web flow with the App's client ID). Sessions live in D1 (ADR-0014).
- **"Your repositories" (`/me`)** lists the repositories of the user's installations. "Add repositories" links to the App's installation page.
- **Access is checked on every view,** with the user's token, cached for five minutes. A Connected Repository's Report is served only to signed-in users who can see the repository on GitHub right now. Public repositories need no sign-in.
- **The Site signs the App's JWT** (RS256, WebCrypto) and exchanges it for an installation token when it starts a Build. The token goes to the Builder with the Build and is never stored.
- **Webhooks** (`installation`, `installation_repositories`) keep D1 in step. Their signatures are verified. Uninstalling deletes that installation's stored Reports.
- **Retention:** a Connected Repository's Report is deleted after 30 days without a view. "Delete my data" on `/me` removes the account, its sessions and its Reports at once.
- **Choice:** the page offers `commitscape share` to anyone who would rather keep their code off the Site. It is analysed locally, and the Site only ever sees ciphertext (ADR-0016).

## Consequences

- **The owner creates the App on GitHub.** They keep its private key, client secret and webhook secret as Worker secrets. `DEPLOY.md` lists the settings.
- **Private repositories' history is cloned onto the owner's VPS during a Build.** The clone is deleted after the Build. Only the Report is kept, in R2, which Cloudflare encrypts at rest. The privacy page says exactly this.
