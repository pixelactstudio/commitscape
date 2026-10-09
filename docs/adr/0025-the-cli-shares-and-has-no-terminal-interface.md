# The CLI shares, and has no terminal interface

The terminal interface is gone, and with it `check`, `card`, `who`, `wrapped` and `github`. The CLI keeps four commands: `share`, `report`, `surviving` and `health`. A bare `commitscape` is `share`: it says what it will upload, asks (Enter means yes), uploads the locked Report and opens its link in the browser.

## Status

accepted (2026-10-09, architecture review). Supersedes ADR-0010's local interface and ADR-0002's first-paint budget; narrows ADR-0009 to `health`.

## Context

ADR-0020 turned the product to people: what a developer built, next to the people they work with, shown on the Site and shared as Cards. The terminal interface was built for the repository-first product. Its screens (Hotspots, risk, change groups) are gone from the Site, and keeping a second interface in step with the Site cost more than it gave: about 7,300 lines in its own crate, a snapshot test per screen, and ratatui in every build.

`check`, `who` and `wrapped` answered repository-first questions the Site no longer asks. `card` drew the interface's own card, unlike the Site's Cards (ADR-0021). `github` fetched pull requests for the interface; the Site reads them itself.

## Decision

- **A bare `commitscape [path]` is `share`.** The prompt says what the Report holds (file paths, names, GitHub logins, commit subjects; no email addresses), that the Site cannot read it, and how long the link works, then asks `Upload it? [Y/n]`. After a yes it uploads, prints the link and opens it in the default browser; `--no-open` does not. Without a terminal it uploads only with `--yes`, and never opens a browser.
- **`report`** writes the Report to a file and never uploads. It takes what the Builder needs: `--commits-out` writes the Commit List apart (ADR-0024), and `--accounts` joins identities on the GitHub logins it is given (ADR-0011, ADR-0026).
- **`surviving`** and **`health`** stay as they were; `surviving` takes `--accounts` too, so its people match the Report's.
- **Hotspots, risk and everything only the removed commands used** are deleted from the metrics, the Report and the Site. Change Coupling stays, because the Map's file view shows what changes with a file.
- **Cards for a README** come from the Site, through the card action (`actions/card`) or the Card's address.

## Consequences

- The CLI is smaller and has one job on a machine: get a Report to a browser, or to a file.
- Opening the browser hands the link, key included, to the platform's opener (`xdg-open`, `open`, `cmd /c start`) as an argument, visible to the same user's processes for a moment. The person has just agreed to share it.
- Anyone who used `commitscape check` in a hook or CI loses it, along with the check action.
