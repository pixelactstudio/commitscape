[English](../../README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [Deutsch](./README.de.md) · **Français** · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>Ce que vous avez construit, où vous vous situez parmi les gens avec qui vous travaillez, et des cartes pour le partager.</p>
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

commitscape montre à un développeur ou une développeuse ce qu'il a construit : les pull requests fusionnées, les revues données et ses lignes qui tournent encore, comptées avec blame à partir de l'historique propre à chaque dépôt. Il montre où l'on se situe parmi les gens avec qui l'on travaille, vue par vue et jamais en un seul score, et en fait des cartes (Cards) pour un README, une auto-évaluation ou une publication. Il lit tout l'historique d'un grand dépôt en quelques secondes, à partir des données de git lui-même.

![L'histoire de commitscape, dessinée par commitscape](../../.github/commitscape-card.svg)

Il y a deux façons de l'utiliser :

1. **Depuis votre terminal.** Lancez `npx commitscape` dans n'importe quel dépôt git. Il dit ce qu'il va envoyer et demande d'abord (Entrée veut dire oui), lit l'historique sur votre machine, envoie le rapport (Report) verrouillé par une clé que seul le lien détient, et ouvre le lien dans votre navigateur. Le lien reste valable 4 heures, et le site (Site) ne peut pas lire ce qu'il stocke.
2. **Sur le site.** Connectez-vous avec GitHub, puis tapez n'importe quel identifiant GitHub pour voir son profil (Profile) : totaux, lignes survivantes (Surviving Lines), archétype (Archetype) et réussites (Achievements), où se trouve son travail, cartes à intégrer, preuve de travail (Proof of Work) sur une période, Versus et Wrapped. Collez le lien d'un dépôt pour voir son rapport et son classement (Standings), ou choisissez vos propres dépôts, privés compris. Chacun peut rester en dehors des comparaisons.

Le projet en est au début de son développement. La CLI et le site fonctionnent de bout en bout.

## Pour commencer

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

`--no-open` affiche le lien sans ouvrir de navigateur, `--yes` envoie sans demander (pour les scripts ; il n'ouvre jamais de navigateur) et `--expires 12` garde le lien en ligne 12 heures. `commitscape share --list` liste les liens créés par cette machine et `--delete <link>` en retire un.

## Installation

| Comment | Commande |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape` ou `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket`, puis `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | le `.deb` de la [dernière version](https://github.com/pixelactstudio/commitscape/releases/latest) : `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | le `.rpm` de la dernière version : `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| Un binaire | l'archive de votre plateforme dans la dernière version |

Des binaires précompilés existent pour Linux sur x64 et ARM (glibc ou musl), macOS sur Intel et Apple silicon, et Windows sur x64. Le paquet npm n'installe que le binaire de votre plateforme, n'exécute rien à l'installation et n'a pas besoin de Node pour tourner.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `commitscape [path]` | Comme `commitscape share` : demande, envoie le rapport verrouillé et ouvre son lien |
| `commitscape share [path]` | Un lien verrouillé vers le rapport de ce dépôt, pour n'importe quel navigateur ; `--list` et `--delete <link>` les gèrent |
| `commitscape surviving [path] --person <id>` | Les lignes survivantes d'une personne : les lignes de la tête que blame lui attribue, en traversant les commits de reformatage |
| `commitscape health <owner/name>` | Si un projet GitHub est vivant et s'il dépend d'une seule personne |

`--help` sur n'importe quelle commande liste toutes les options.

## Des cartes dans un README

La [card action](../../actions/card) conserve des cartes du site dans votre dépôt et les tient à jour selon un calendrier :

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

Vous pouvez aussi intégrer directement l'adresse d'une carte du site ; son atelier de cartes, à `/u/<login>/cards`, donne l'adresse de chacune. Les cartes s'ouvrent sans connexion, donc les README peuvent les afficher.

## Sur le site

- **N'importe quel dépôt GitHub public.** Allez sur `/gh/<owner>/<name>`. Les informations de GitHub s'affichent tout de suite, et le rapport suit une fois l'historique lu : quelques secondes pour la plupart des dépôts. Les lignes modifiées (Lines Changed) arrivent ensuite, celles de la branche par défaut en premier.
- **Vos propres dépôts.** Choisissez des dépôts via la GitHub App de commitscape, qui ne peut que lire. Le rapport d'un dépôt privé n'est montré qu'aux personnes qui, selon GitHub, peuvent le voir.
- **Ouvert à tous.** Les cartes, les rapports partagés (Shared Reports) et les preuves de travail partagées. Toutes les autres pages demandent une connexion avec GitHub, pour que ce que vous ouvrez soit lu avec votre propre quota GitHub.
- **Pour les clients MCP.** Quand le site définit un jeton, `/mcp` cherche un dépôt et lit son rapport, des profils et son classement.

`/privacy` sur le site dit ce qu'il conserve, où, combien de temps, et qui peut le lire.

## Confidentialité

Sur votre machine, commitscape n'envoie rien nulle part tant que vous n'avez pas dit oui :

- `share` (et `commitscape` seul) envoie le rapport chiffré avec AES-256-GCM. La clé n'est que dans le lien, après le `#`, que les navigateurs n'envoient jamais : le site stocke donc ce qu'il ne peut pas lire. Aucune adresse e-mail n'y figure jamais.
- `surviving` lit le dépôt sur votre machine (si on lui donne une adresse GitHub, il le clone). `health` interroge GitHub, via la [CLI GitHub](https://cli.github.com), sur le projet qu'on lui donne.
- Pas d'analytics, pas de vérification de mises à jour, et rien ne s'exécute à l'installation.

Sur le site, aucune adresse e-mail ne quitte le Builder : les packs à partir desquels répond le service du moteur n'en contiennent aucune.

## Comment c'est construit

Un seul moteur en Rust lit l'historique git : dans la CLI sur votre machine, et dans le Builder pour le site. Le site n'exécute jamais git.

![Qui parle à qui : le site, le service du moteur, le Builder, Postgres, R2 et GitHub](../diagrams/system.svg)

- **Le site** (TanStack Start sur Node) dessine chaque page côté serveur, pour les personnes connectées. Il garde des lignes et la file des builds (Builds) dans Postgres et des fichiers dans R2, et demande au service du moteur tout ce qui exige de parcourir l'historique d'un dépôt.
- **Le service du moteur (engine service)** (Rust, `apps/engine`) répond à partir de packs : chacun est l'index (Index) d'un dépôt à une tête, écrit par un build et jamais modifié ensuite. Il récupère un pack dans R2 une seule fois et le garde sur disque et en mémoire, si bien que n'importe quelle fenêtre (Window) de n'importe quel dépôt prend quelques millisecondes.
- **Le Builder** prend les builds dans la file, clone le dépôt et lance `commitscape build`.
- **La page d'accueil** est statique, sur Cloudflare Pages, à part du site.

![Un build : d'abord le rapport, puis les lignes modifiées, la ligne principale en premier](../diagrams/build.svg)

Un build à froid lance deux phases en même temps. Un clone sans l'ancien contenu des fichiers donne le premier rapport en quelques secondes ; un clone complet, qui partage le même cache du moteur, compte les lignes modifiées : la ligne principale (Mainline) d'abord, des plus récents aux plus anciens, dans un budget de temps, avec des builds discrets ensuite pour le reste. Chaque phase copie ses lignes dans l'index stocké (Stored Index) dans Postgres et envoie un nouveau pack, que le service du moteur récupère à la première question qui le concerne.

![L'affichage d'une page : d'où viennent les réponses et ce qui est gardé](../diagrams/read.svg)

Le loader d'une page lit la clé du pack dans Postgres, interroge le service du moteur avec elle, puis lit des lignes (pages de commits, branches, pull requests) dans Postgres et des fichiers stockés (texte des fichiers, l'Atlas de l'Universe, cartes) dans R2. Les réponses sont gardées dans le service du moteur et, compressées, dans le site ; les adresses d'un dépôt public figées sur un build restent en cache un an.

| Dossier | Contenu |
|---|---|
| `crates/` | Rust : le moteur qui lit git, les métriques, le rapport et la CLI |
| `apps/site/` | Le site : TanStack Start sur Node, rendu côté serveur, avec Better Auth |
| `apps/engine/` | Le service du moteur : répond aux questions du site à partir de packs (axum, tokio) |
| `apps/builder/` | Le Builder : prend les builds d'une file Postgres, clone le dépôt, lance `commitscape build`, charge l'index stocké dans Postgres et envoie le pack vers R2 |
| `apps/landing/` | La page d'accueil : du HTML statique dessiné au build, pour Cloudflare Pages |
| `packages/server/` | Le schéma et les migrations de la base, le stockage R2, la file et le chargeur de l'index stocké |
| `packages/ui/` | Chaque écran et chaque graphique du site |
| `packages/data/` | Les types du rapport, générés depuis Rust, et les sources de données |

Ces documents sont en anglais :

- [Langage du domaine](../../CONTEXT.md)
- [Décisions d'architecture](../adr), la plus récente [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [Comment les pièces s'assemblent](../working.md)
- [L'index stocké dans Postgres](../index-in-postgres.md)
- [Les limites de l'API GitHub](../github-api.md)
- [Déploiement](../../DEPLOY.md)
- [Publication des versions](../../RELEASING.md)

## Héberger soi-même

Le site, le service du moteur et le Builder sont publiés en images Docker à chaque fusion et à chaque version. [DEPLOY.md](../../DEPLOY.md) explique comment les faire tourner dans Dokploy, sur un ou deux serveurs, avec Postgres, un bucket Cloudflare R2 et la page d'accueil sur Cloudflare Pages.

## Développement

Prérequis : Rust (stable), Node.js 24, pnpm 12 et Docker.

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

`pnpm services` démarre Postgres et un substitut de S3 dans Docker. Définissez `BETTER_AUTH_SECRET` dans `apps/site/.env` (`openssl rand -hex 32`). Le site tourne sur [http://localhost:3100](http://localhost:3100), le service du moteur sur le port 4100, et `pnpm dev:landing` dessine la page d'accueil sur [http://localhost:3200](http://localhost:3200). La connexion GitHub, Sentry et PostHog restent désactivés tant que leurs clés sont vides.

| Commande | Rôle |
|---|---|
| `cargo test --workspace` | Tous les tests Rust, y compris les réponses de référence du service du moteur |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lints Rust |
| `cargo xtask check-layering` | Vérifie que les crates ne dépendent les unes des autres que comme prévu |
| `pnpm check` | Vérification des types, lint, tests et build de chaque paquet TypeScript |
| `pnpm e2e` | Le site, le service du moteur et le Builder de bout en bout dans Chromium, avec des contrôles d'accessibilité |
| `pnpm db:generate` | Écrit la migration d'un changement de schéma |
| `cargo xtask bench` | Temps mesurés sur de grands dépôts |

## Technologies

- Rust, gix et imara-diff ; axum et tokio pour le service du moteur
- TanStack Start, React 19, TypeScript et Vite
- Astryx et Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss et Cloudflare R2
- Better Auth, PostHog et Sentry
- Turborepo, oxlint, Vitest et Playwright

## Convention de commits

Les commits et les titres de pull requests suivent [Conventional Commits](https://www.conventionalcommits.org/). Les versions, leurs numéros et le changelog en sont générés ([RELEASING.md](../../RELEASING.md)) :

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## Licence

commitscape est un logiciel libre, sous [licence MIT](../../LICENSE-MIT) ou [licence Apache 2.0](../../LICENSE-APACHE), au choix. Copyright 2026 Dev Talan.

Un projet open source de [Pixelact Studio](https://pixelactstudio.com).
