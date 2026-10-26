[English](../../README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · **Deutsch** · [Français](./README.fr.md) · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>Was du gebaut hast, wo du neben den Leuten stehst, mit denen du arbeitest, und Karten, um es zu teilen.</p>
</div>

<p align="center">
  <a href="https://github.com/pixelactstudio/commitscape/actions/workflows/ci.yml">
    <img src="https://github.com/pixelactstudio/commitscape/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/pixelactstudio/commitscape/actions/workflows/docker.yml">
    <img src="https://github.com/pixelactstudio/commitscape/actions/workflows/docker.yml/badge.svg" alt="Docker images" />
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-MIT%20or%20Apache--2.0-blue" alt="MIT or Apache-2.0 license" />
  </a>
</p>

commitscape zeigt Entwicklerinnen und Entwicklern, was sie gebaut haben: gemergte Pull Requests, abgegebene Reviews und die eigenen Zeilen, die noch laufen, mit blame aus der Geschichte jedes Repositorys selbst gezählt. Es zeigt, wo jemand neben den Leuten steht, mit denen er arbeitet, Ansicht für Ansicht und nie als eine einzige Punktzahl, und macht daraus Karten (Cards) für ein README, eine Selbsteinschätzung oder einen Beitrag. Die ganze Geschichte eines großen Repositorys liest es in Sekunden, aus den Daten von git selbst.

![Die Geschichte von commitscape, gezeichnet von commitscape](../../.github/commitscape-card.svg)

Es gibt zwei Wege, es zu nutzen:

1. **Im Terminal.** Führe `npx commitscape` in einem beliebigen git-Repository aus. Es sagt, was es hochladen wird, und fragt vorher (Enter heißt ja), liest die Geschichte auf deinem Rechner, lädt den Bericht (Report) hoch, verschlossen mit einem Schlüssel, den nur der Link kennt, und öffnet den Link im Browser. Der Link gilt 4 Stunden, und die Website (Site) kann nicht lesen, was sie speichert.
2. **Auf der Website.** Melde dich mit GitHub an und gib einen beliebigen GitHub-Namen ein, um das Profil (Profile) dieser Person zu sehen: Summen, überlebende Zeilen (Surviving Lines), Archetyp (Archetype) und Erfolge (Achievements), wo ihre Arbeit liegt, Karten zum Einbetten, Arbeitsnachweis (Proof of Work) für einen Zeitraum, Versus und Wrapped. Füge den Link eines Repositorys ein, um seinen Bericht und seine Rangfolge (Standings) zu sehen, oder wähle deine eigenen Repositorys, auch private. Jede Person kann sich aus Vergleichen heraushalten.

Das Projekt ist in einer frühen Phase. CLI und Website funktionieren von Anfang bis Ende.

## Loslegen

```sh
npx commitscape
```

```text
This uploads my-project's Report to https://app.commitscape.com.
  It holds file paths, people's names and GitHub logins, and commit subjects. No email addresses.
  It is locked with a key only the link holds, so the Site cannot read it.
  The link works for 4 hours.
Upload it? [Y/n]
https://app.commitscape.com/s/k3f9q2x7#0dbf…
```

`--no-open` gibt den Link aus, ohne einen Browser zu öffnen, `--yes` lädt ohne Nachfrage hoch (für Skripte; es öffnet nie einen Browser), und `--expires 12` hält den Link 12 Stunden lang offen. `commitscape share --list` listet die Links, die dieser Rechner erstellt hat, und `--delete <link>` nimmt einen davon offline.

## Installation

| Wie | Befehl |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape` oder `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket`, dann `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | das `.deb` aus dem [neuesten Release](https://github.com/pixelactstudio/commitscape/releases/latest): `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | das `.rpm` aus dem neuesten Release: `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| Ein Binary | das Archiv für deine Plattform aus dem neuesten Release |

Fertige Binaries gibt es für Linux auf x64 und ARM (glibc oder musl), macOS auf Intel und Apple Silicon und Windows auf x64. Das npm-Paket installiert nur das Binary deiner Plattform, führt bei der Installation nichts aus und braucht zur Laufzeit kein Node.

## Befehle

| Befehl | Was er tut |
|---|---|
| `commitscape [path]` | Dasselbe wie `commitscape share`: fragt, lädt den verschlossenen Bericht hoch und öffnet seinen Link |
| `commitscape share [path]` | Ein verschlossener Link zum Bericht dieses Repositorys, für jeden Browser; `--list` und `--delete <link>` verwalten sie |
| `commitscape surviving [path] --person <id>` | Die überlebenden Zeilen einer Person: die Zeilen im Head, die blame ihr zuschreibt, wobei reine Umformatierungen übersprungen werden |
| `commitscape health <owner/name>` | Ob ein GitHub-Projekt lebt und ob es an einer einzigen Person hängt |

`--help` zeigt bei jedem Befehl alle Optionen.

## Karten im README

Die [card action](../../actions/card) legt Karten der Website in deinem Repository ab und hält sie nach Zeitplan aktuell:

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

Oder bette die Adresse einer Karte der Website direkt ein; ihr Kartenstudio unter `/u/<login>/cards` nennt die Adresse jeder Karte. Karten öffnen sich ohne Anmeldung, deshalb können READMEs sie zeigen.

## Auf der Website

- **Jedes öffentliche GitHub-Repository.** Öffne `/gh/<owner>/<name>`. Die Angaben von GitHub erscheinen sofort, der Bericht folgt, sobald die Geschichte gelesen ist: bei den meisten Repositorys in Sekunden. Die geänderten Zeilen (Lines Changed) kommen danach, die des Standard-Branches zuerst.
- **Deine eigenen Repositorys.** Wähle Repositorys über die GitHub App von commitscape, die nur lesen kann. Den Bericht eines privaten Repositorys sehen nur Leute, die es laut GitHub sehen dürfen.
- **Für alle offen.** Karten, geteilte Berichte (Shared Reports) und geteilte Arbeitsnachweise. Alle anderen Seiten verlangen eine Anmeldung mit GitHub, damit das, was du öffnest, mit deinem eigenen GitHub-Kontingent gelesen wird.
- **Für MCP-Clients.** Wenn die Website ein Token setzt, sucht `/mcp` ein Repository und liest seinen Bericht, Profile und die Rangfolge.

`/privacy` auf der Website sagt, was sie speichert, wo, wie lange und wer es lesen kann.

## Datenschutz

Auf deinem Rechner schickt commitscape nichts irgendwohin, bevor du ja sagst:

- `share` (und `commitscape` ohne Befehl) lädt den Bericht mit AES-256-GCM verschlüsselt hoch. Der Schlüssel steht nur im Link, hinter dem `#`, den Browser nie senden; die Website speichert also, was sie nicht lesen kann. E-Mail-Adressen sind nie enthalten.
- `surviving` liest das Repository auf deinem Rechner (bekommt es eine GitHub-Adresse, klont es das Repository). `health` fragt GitHub über die [GitHub CLI](https://cli.github.com) nach dem angegebenen Projekt.
- Keine Analytics, keine Update-Prüfungen, und bei der Installation läuft nichts.

Auf der Website verlässt keine E-Mail-Adresse den Builder: Die Packs, aus denen der Engine-Dienst antwortet, enthalten keine.

## Wie es gebaut ist

Eine einzige Rust-Engine liest die git-Geschichte: in der CLI auf deinem Rechner und im Builder für die Website. Die Website selbst führt nie git aus.

![Wer mit wem spricht: Website, Engine-Dienst, Builder, Postgres, R2 und GitHub](../diagrams/system.svg)

- **Die Website** (TanStack Start auf Node) zeichnet jede Seite auf dem Server, für angemeldete Personen. Sie hält Zeilen und die Warteschlange der Builds in Postgres und Dateien in R2 und fragt den Engine-Dienst nach allem, wofür die Geschichte eines Repositorys durchlaufen werden muss.
- **Der Engine-Dienst (engine service)** (Rust, `apps/engine`) antwortet aus Packs: Jedes ist der Index eines Repositorys an einem Head, von einem Build geschrieben und danach nie verändert. Er holt ein Pack einmal aus R2 und hält es auf der Platte und im Speicher, sodass jedes Zeitfenster (Window) jedes Repositorys Millisekunden dauert.
- **Der Builder** nimmt Builds aus der Warteschlange, klont das Repository und führt `commitscape build` aus.
- **Die Startseite** ist statisch und liegt auf Cloudflare Pages, getrennt von der Website.

![Ein Build: zuerst der Bericht, dann die geänderten Zeilen, die Hauptlinie zuerst](../diagrams/build.svg)

Ein kalter Build führt zwei Phasen gleichzeitig aus. Ein Klon ohne alte Dateiinhalte liefert den ersten Bericht in Sekunden; ein vollständiger Klon, der denselben Engine-Cache teilt, zählt die geänderten Zeilen: die Hauptlinie (Mainline) zuerst, die neuesten Commits zuerst, innerhalb eines Zeitbudgets, mit stillen Builds danach für den Rest. Jede Phase kopiert ihre Zeilen in den gespeicherten Index (Stored Index) in Postgres und lädt ein neues Pack hoch, und der Engine-Dienst holt dieses Pack bei der ersten Frage danach.

![Ein Seitenaufruf: woher die Antworten kommen und was behalten wird](../diagrams/read.svg)

Der Loader einer Seite liest den Schlüssel des Packs aus Postgres, fragt damit den Engine-Dienst und liest Zeilen (Commit-Seiten, Branches, Pull Requests) aus Postgres und gespeicherte Dateien (Dateitexte, das Atlas des Universe, Karten) aus R2. Antworten werden im Engine-Dienst und, gepackt, in der Website behalten; die an einen Build gebundenen Adressen eines öffentlichen Repositorys werden ein Jahr lang gecacht.

| Ordner | Inhalt |
|---|---|
| `crates/` | Rust: die Engine, die git liest, die Metriken, der Bericht und die CLI |
| `apps/site/` | Die Website: TanStack Start auf Node, serverseitig gerendert, mit Better Auth |
| `apps/engine/` | Der Engine-Dienst: beantwortet die Fragen der Website aus Packs (axum, tokio) |
| `apps/builder/` | Der Builder: nimmt Builds aus einer Postgres-Warteschlange, klont das Repository, führt `commitscape build` aus, lädt den gespeicherten Index in Postgres und das Pack nach R2 |
| `apps/landing/` | Die Startseite: beim Build gezeichnetes statisches HTML für Cloudflare Pages |
| `packages/server/` | Datenbankschema und Migrationen, R2-Speicher, die Warteschlange und der Lader des gespeicherten Index |
| `packages/ui/` | Jeder Bildschirm und jedes Diagramm der Website |
| `packages/data/` | Die Typen des Berichts, aus Rust erzeugt, und die Datenquellen |

Diese Dokumente sind auf Englisch:

- [Begriffe der Domäne](../../CONTEXT.md)
- [Architekturentscheidungen](../adr), die neueste [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [Wie die Teile zusammenarbeiten](../working.md)
- [Der gespeicherte Index in Postgres](../index-in-postgres.md)
- [Die Grenzen der GitHub-API](../github-api.md)
- [Deployment](../../DEPLOY.md)
- [Releases](../../RELEASING.md)

## Selbst betreiben

Website, Engine-Dienst und Builder werden bei jedem Merge und jedem Release als Docker-Images veröffentlicht. [DEPLOY.md](../../DEPLOY.md) beschreibt, wie man sie in Dokploy betreibt, auf einem oder zwei Servern, mit Postgres, einem Cloudflare-R2-Bucket und der Startseite auf Cloudflare Pages.

## Entwicklung

Voraussetzungen: Rust (stable), Node.js 24, pnpm 12 und Docker.

```sh
git clone git@github.com:pixelactstudio/commitscape.git
cd commitscape
pnpm install
pnpm services
cargo xtask fixtures --force
cargo build --release -p commitscape
cp apps/site/.env.example apps/site/.env
cp apps/builder/.env.example apps/builder/.env
cp apps/engine/.env.example apps/engine/.env
pnpm dev:engine
pnpm dev:builder
pnpm dev:site
```

`pnpm services` startet Postgres und einen S3-Ersatz in Docker. Setze `BETTER_AUTH_SECRET` in `apps/site/.env` (`openssl rand -hex 32`). Die Website läuft unter [http://localhost:3100](http://localhost:3100), der Engine-Dienst auf Port 4100, und `pnpm dev:landing` zeichnet die Startseite unter [http://localhost:3200](http://localhost:3200). GitHub-Anmeldung, Sentry und PostHog bleiben aus, solange ihre Schlüssel leer sind.

| Befehl | Zweck |
|---|---|
| `cargo test --workspace` | Alle Rust-Tests, einschließlich der Referenzantworten des Engine-Dienstes |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust-Lints |
| `cargo xtask check-layering` | Prüft, dass die Crates nur wie vorgesehen voneinander abhängen |
| `pnpm check` | Typprüfung, Lint, Tests und Build für jedes TypeScript-Paket |
| `pnpm e2e` | Website, Engine-Dienst und Builder von Anfang bis Ende in Chromium, mit Barrierefreiheitsprüfungen |
| `pnpm db:generate` | Schreibt die Migration für eine Schemaänderung |
| `cargo xtask bench` | Zeiten auf großen Repositorys |

## Technik

- Rust, gix und imara-diff; axum und tokio für den Engine-Dienst
- TanStack Start, React 19, TypeScript und Vite
- Astryx und Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss und Cloudflare R2
- Better Auth, PostHog und Sentry
- Turborepo, oxlint, Vitest und Playwright

## Commit-Konventionen

Commits und Titel von Pull Requests folgen den [Conventional Commits](https://www.conventionalcommits.org/). Releases, Versionsnummern und das Changelog werden daraus erzeugt ([RELEASING.md](../../RELEASING.md)):

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## Lizenz

commitscape ist Open-Source-Software, nach deiner Wahl unter der [MIT-Lizenz](../../LICENSE-MIT) oder der [Apache-Lizenz 2.0](../../LICENSE-APACHE). Copyright 2026 Dev Talan.

Ein Open-Source-Projekt von [Pixelact Studio](https://pixelactstudio.com).
