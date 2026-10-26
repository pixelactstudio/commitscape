[English](../../README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · **Português** · [Deutsch](./README.de.md) · [Français](./README.fr.md) · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>O que você construiu, como você se compara às pessoas com quem trabalha, e cards para compartilhar isso.</p>
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

O commitscape mostra a quem desenvolve o que essa pessoa construiu: pull requests mesclados, revisões feitas e as linhas dela que continuam rodando, contadas com blame a partir da própria história de cada repositório. Mostra como ela se compara às pessoas com quem trabalha, uma visão por vez e nunca em uma nota única, e transforma isso em cards (Cards) para um README, uma autoavaliação ou um post. Ele lê toda a história de um repositório grande em segundos, a partir dos dados do próprio git.

![A história do commitscape, desenhada pelo commitscape](../../.github/commitscape-card.svg)

Há duas formas de usar:

1. **No terminal.** Rode `npx commitscape` em qualquer repositório git. Ele diz o que vai enviar e pergunta antes (Enter significa sim), lê a história na sua máquina, envia o relatório (Report) trancado com uma chave que só o link tem e abre o link no navegador. O link vale por 4 horas, e o site (Site) não consegue ler o que guarda.
2. **No site.** Entre com o GitHub e digite qualquer usuário do GitHub para ver o perfil (Profile) dessa pessoa: totais, linhas que sobrevivem (Surviving Lines), arquétipo (Archetype) e conquistas (Achievements), onde está o trabalho dela, cards para incorporar, prova de trabalho (Proof of Work) de um período, Versus e Wrapped. Cole o link de um repositório para ver o relatório e a classificação (Standings) dele, ou escolha seus próprios repositórios, inclusive os privados. Qualquer pessoa pode ficar de fora das comparações.

O projeto está no início do desenvolvimento. A CLI e o site funcionam de ponta a ponta.

## Primeiros passos

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

`--no-open` mostra o link sem abrir o navegador, `--yes` envia sem perguntar (para scripts; nunca abre o navegador) e `--expires 12` mantém o link no ar por 12 horas. `commitscape share --list` lista os links que esta máquina criou e `--delete <link>` derruba um deles.

## Instalação

| Como | Comando |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape` ou `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket` e depois `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | o `.deb` da [versão mais recente](https://github.com/pixelactstudio/commitscape/releases/latest): `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | o `.rpm` da versão mais recente: `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| Um binário | o arquivo da sua plataforma na versão mais recente |

Há binários prontos para Linux em x64 e ARM (glibc ou musl), macOS em Intel e Apple silicon e Windows em x64. O pacote do npm instala só o binário da sua plataforma, não executa nada na instalação e não precisa de Node para rodar.

## Comandos

| Comando | O que faz |
|---|---|
| `commitscape [path]` | O mesmo que `commitscape share`: pergunta, envia o relatório trancado e abre o link |
| `commitscape share [path]` | Um link trancado para o relatório deste repositório, para qualquer navegador; `--list` e `--delete <link>` cuidam deles |
| `commitscape surviving [path] --person <id>` | As linhas que sobrevivem de uma pessoa: as linhas no head que o blame atribui a ela, atravessando commits de formatação |
| `commitscape health <owner/name>` | Se um projeto do GitHub está vivo e se depende de uma só pessoa |

`--help` em qualquer comando lista todas as opções.

## Cards no README

A [card action](../../actions/card) guarda cards do site no seu repositório e os mantém atualizados conforme uma agenda:

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

Ou incorpore diretamente o endereço de um card do site; o estúdio de cards em `/u/<login>/cards` dá o endereço de cada um. Os cards abrem sem login, então os READMEs conseguem mostrá-los.

## No site

- **Qualquer repositório público do GitHub.** Vá para `/gh/<owner>/<name>`. Os dados do GitHub aparecem na hora, e o relatório vem quando a história é lida: segundos na maioria dos repositórios. As linhas alteradas (Lines Changed) chegam depois, primeiro as do branch principal.
- **Seus próprios repositórios.** Escolha repositórios pelo GitHub App do commitscape, que só consegue ler. O relatório de um repositório privado só aparece para quem o GitHub diz que pode vê-lo.
- **Aberto a qualquer pessoa.** Cards, relatórios compartilhados (Shared Reports) e provas de trabalho compartilhadas. Todas as outras páginas pedem login com o GitHub, então o que você abre é lido com a sua própria cota do GitHub.
- **Para clientes MCP.** Quando o site define um token, `/mcp` procura um repositório e lê o relatório, os perfis e a classificação dele.

`/privacy` no site explica o que ele guarda, onde, por quanto tempo e quem pode ler.

## Privacidade

Na sua máquina, o commitscape não envia nenhum repositório para lugar nenhum até você dizer sim:

- `share` (e `commitscape` sozinho) envia o relatório criptografado com AES-256-GCM. A chave fica só no link, depois do `#`, que os navegadores nunca enviam, então o site guarda algo que não consegue ler. Nenhum endereço de e-mail é incluído.
- `surviving` lê o repositório na sua máquina (se você der um endereço do GitHub, ele clona). `health` pergunta ao GitHub, pela [GitHub CLI](https://cli.github.com), sobre o projeto que recebe.
- Cada execução de `share`, `health`, `surviving` ou `report` envia ao site uma contagem de uso anônima: o comando, quanto tempo levou, como terminou, a versão e a sua plataforma, sob um id aleatório. Nunca um caminho nem nada de um repositório. `COMMITSCAPE_TELEMETRY=0` ou `DO_NOT_TRACK=1` desliga isso.
- Sem verificação de atualizações e nada executado na instalação.

No site, nenhum endereço de e-mail sai do Builder: os packs com que o serviço do motor responde não têm nenhum.

## Como é construído

Um único motor em Rust lê a história do git: dentro da CLI na sua máquina e dentro do Builder para o site. O site nunca executa git.

![Quem fala com quem: o site, o serviço do motor, o Builder, Postgres, R2 e GitHub](../diagrams/system.svg)

- **O site** (TanStack Start sobre Node) desenha cada página no servidor, para quem está logado. Guarda linhas de dados e a fila de builds (Builds) no Postgres e arquivos no R2, e pergunta ao serviço do motor tudo o que exige percorrer a história de um repositório.
- **O serviço do motor (engine service)** (Rust, `apps/engine`) responde a partir de packs: cada um é o índice (Index) de um repositório em um head, escrito por um build e nunca alterado. Ele busca um pack no R2 uma única vez e o mantém em disco e na memória, então qualquer janela (Window) de qualquer repositório leva milissegundos.
- **O Builder** pega builds da fila, clona o repositório e roda `commitscape build`.
- **A página inicial** é estática, fica no Cloudflare Pages, separada do site.

![Um build: primeiro o relatório, depois as linhas alteradas, a linha principal primeiro](../diagrams/build.svg)

Um build a frio roda duas fases ao mesmo tempo. Um clone sem o conteúdo antigo dos arquivos entrega o primeiro relatório em segundos; um clone completo, que compartilha o mesmo cache do motor, conta as linhas alteradas: a linha principal (Mainline) primeiro, do mais novo para o mais antigo, dentro de um orçamento de tempo, com builds silenciosos depois para o que sobrar. Cada fase copia suas linhas para o índice armazenado (Stored Index) no Postgres e envia um pack novo, e o serviço do motor busca esse pack na primeira pergunta sobre ele.

![Uma visita a uma página: de onde vêm as respostas e o que fica guardado](../diagrams/read.svg)

O loader de uma página lê a chave do pack no Postgres, pergunta ao serviço do motor com ela, e lê linhas de dados (páginas de commits, branches, pull requests) do Postgres e arquivos guardados (texto dos arquivos, o Atlas do Universe, cards) do R2. As respostas ficam guardadas no serviço do motor e, compactadas, no site; os endereços de um repositório público fixados em um build ficam em cache por um ano.

| Pasta | O quê |
|---|---|
| `crates/` | Rust: o motor que lê git, as métricas, o relatório e a CLI |
| `apps/site/` | O site: TanStack Start sobre Node, renderizado no servidor, com Better Auth |
| `apps/engine/` | O serviço do motor: responde às perguntas do site a partir de packs (axum, tokio) |
| `apps/builder/` | O Builder: pega builds de uma fila no Postgres, clona o repositório, roda `commitscape build`, carrega o índice armazenado no Postgres e envia o pack para o R2 |
| `apps/landing/` | A página inicial: HTML estático desenhado no build, para o Cloudflare Pages |
| `packages/server/` | O schema e as migrações do banco, o armazenamento no R2, a fila e o carregador do índice armazenado |
| `packages/ui/` | Cada tela e gráfico que o site mostra |
| `packages/data/` | Os tipos do relatório, gerados a partir do Rust, e as fontes de dados |

Estes documentos estão em inglês:

- [Linguagem do domínio](../../CONTEXT.md)
- [Decisões de arquitetura](../adr), a mais recente [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [Como as peças trabalham juntas](../working.md)
- [O índice armazenado no Postgres](../index-in-postgres.md)
- [Os limites da API do GitHub](../github-api.md)
- [Deploy](../../DEPLOY.md)
- [Lançamento de versões](../../RELEASING.md)

## Hospedar por conta própria

O site, o serviço do motor e o Builder são publicados como imagens Docker a cada merge e a cada versão. O [DEPLOY.md](../../DEPLOY.md) explica como rodá-los no Dokploy, em um ou dois servidores, com Postgres, um bucket do Cloudflare R2 e a página inicial no Cloudflare Pages.

## Desenvolvimento

Requisitos: Rust (stable), Node.js 24, pnpm 12 e Docker.

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

`pnpm services` sobe o Postgres e um substituto do S3 no Docker. Defina `BETTER_AUTH_SECRET` em `apps/site/.env` (`openssl rand -hex 32`). O site roda em [http://localhost:3100](http://localhost:3100), o serviço do motor na porta 4100, e `pnpm dev:landing` desenha a página inicial em [http://localhost:3200](http://localhost:3200). Login com GitHub, Sentry e PostHog ficam desligados enquanto as chaves estiverem vazias.

| Comando | Para quê |
|---|---|
| `cargo test --workspace` | Todos os testes de Rust, incluindo as respostas de referência do serviço do motor |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lints de Rust |
| `cargo xtask check-layering` | Confere se os crates dependem uns dos outros só como planejado |
| `pnpm check` | Checagem de tipos, lint, testes e build de cada pacote TypeScript |
| `pnpm e2e` | O site, o serviço do motor e o Builder de ponta a ponta no Chromium, com verificações de acessibilidade |
| `pnpm db:generate` | Escreve a migração de uma mudança de schema |
| `cargo xtask bench` | Tempos em repositórios grandes |

## Tecnologias

- Rust, gix e imara-diff; axum e tokio no serviço do motor
- TanStack Start, React 19, TypeScript e Vite
- Astryx e Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss e Cloudflare R2
- Better Auth, PostHog e Sentry
- Turborepo, oxlint, Vitest e Playwright

## Padrão de commits

Commits e títulos de pull requests seguem [Conventional Commits](https://www.conventionalcommits.org/). As versões, os números de versão e o changelog são gerados a partir deles ([RELEASING.md](../../RELEASING.md)):

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## Licença

O commitscape é software de código aberto, licenciado sob a [Licença MIT](../../LICENSE-MIT) ou a [Licença Apache 2.0](../../LICENSE-APACHE), à sua escolha. Copyright 2026 Dev Talan.

Um projeto de código aberto da [Pixelact Studio](https://pixelactstudio.com).
