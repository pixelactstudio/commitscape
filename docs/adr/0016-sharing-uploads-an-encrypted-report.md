# Sharing uploads an end-to-end encrypted Report; there is no relay

`commitscape share` builds the Report on the user's machine, encrypts it with a random key, uploads the ciphertext to the Site, prints a link, and exits. The key travels only in the link's fragment (`#…`), which browsers never send to a server, so the Site stores data it can't read. A Shared Report expires after 4 hours by default. The Site's page has a Delete button.

## Status

accepted (2026-09-25, Build Run 4 plan).

## Context

The owner works on headless machines and wants to see a repository's analysis in the laptop's browser without Tailscale or SSH port forwarding. The first design was a live relay: the CLI keeps a connection to the Site, and the Site forwards the page's requests to it. The owner rejected it, because it holds a terminal open and dies when the terminal closes. They want disconnecting to happen on the website.

A Report already holds every screen for every Window (ADR-0010, `commitscape report`), and the web app already reads one (`window.__COMMITSCAPE__`). Uploading one needs no process left running and no relay. It also fits the free plan (ADR-0014).

## Decision

1. **Build locally.** The CLI builds the Report data (as `report --data`, with the Commit List) and gzips it.
2. **Encrypt.** It uses AES-256-GCM with a fresh random 256-bit key and a random nonce. From the same key it derives a Delete Token (HKDF-SHA256, info `"commitscape delete"`).
3. **Upload:**
   - `POST /api/shares` with the size, the expiry and the SHA-256 of the Delete Token.
   - The Site answers with an ID (128 random bits, base64url) and a one-time upload token.
   - The CLI uploads the ciphertext with `PUT /api/shares/<id>`, which the Worker streams into R2. No presigned URLs, so no storage credentials, and it runs locally under `wrangler dev`.
4. **Print and exit.** The CLI prints `<site>/s/<id>#<key, base64url>`. Before uploading, it says what will be uploaded (file paths, names, commit messages, encrypted) and asks once, unless `--yes`.
5. **View.** The page reads the key from `location.hash`, then removes it from the address bar with `history.replaceState`. It downloads the ciphertext, decrypts it with WebCrypto, and renders it through the fetched-Report Data Source (ADR-0013).
6. **Delete.** The page's Delete button and `commitscape share --delete <link>` both send the Delete Token. The Site compares its hash in constant time and deletes the object and its row.
7. **Expire.** `--expires` takes 1 to 12 hours; the default is 4. Expired Shares answer 410. A Cron Trigger removes their objects. R2 lifecycle rules act only in days, so they are a backstop only.
8. **Limit.**
   - Uploads: at most 25 MB of ciphertext.
   - Creating Shares: at most N per IP per hour (ADR-0014).
   - The ID alone opens nothing, so guessing IDs gains nothing.
9. **Share from the local page.** Its Share button asks the local server to do the same, when the binary was started with network access. `--offline` disables it.
10. **Remember locally.** `commitscape share --list` lists the Shares this machine made and when they expire, kept in the cache directory.

## Considered options

- **Live relay (CLI ↔ Durable Object ↔ browser):** it holds a terminal, dies with it, and needs a process management story on three operating systems. Rejected by the owner.
- **Background daemon plus relay:** it frees the terminal, but it leaves a process running on someone's server, and all of the relay's costs remain.
- **Unencrypted upload:** simpler, but the Site would then hold private repositories' paths, names and messages.

## Consequences

- **A Shared Report doesn't update itself.** Run `share` again for a new link.
- **Reports can't answer everything a live server can:**
  - A file's details and deeper folders are included only as far as the Report's limits (ADR-0010).
  - Undoing a merged identity is local only.
- **The binary gains an HTTP client with TLS** (`ureq` with rustls) and `aes-gcm`/`hkdf`/`sha2`. That reverses ADR-0009's "no TLS stack" for this one command. `gh` is still how GitHub is asked.
- **Tests must prove the key never leaves the fragment,** and that a tampered ciphertext fails to decrypt.
- **A leaked link is the user's to manage.** Expiry and Delete are the tools.
