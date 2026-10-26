[English](../../README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · **한국어** · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [Deutsch](./README.de.md) · [Français](./README.fr.md) · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>내가 만들어 온 것, 함께 일하는 사람들 사이에서의 내 위치, 그리고 그것을 공유할 카드.</p>
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

commitscape는 개발자가 만들어 온 것을 보여 줍니다. 병합된 pull request, 남긴 리뷰, 그리고 지금도 실행되고 있는 자신의 코드 줄을 각 저장소의 히스토리에서 blame으로 셉니다. 함께 일하는 사람들과 비교해 어디쯤 서 있는지를 하나의 점수로 묶지 않고 관점별로 보여 주며, 그 결과를 README, 자기 평가, 게시물에 쓸 수 있는 카드(Card)로 만들어 줍니다. 큰 저장소의 전체 히스토리도 git 자체의 데이터에서 몇 초 만에 읽습니다.

![commitscape가 그린 commitscape 자신의 이야기](../../.github/commitscape-card.svg)

쓰는 방법은 두 가지입니다.

1. **터미널에서.** 아무 git 저장소에서 `npx commitscape`를 실행합니다. 무엇을 올릴지 먼저 알려 주고 묻습니다(Enter는 "예"). 내 컴퓨터에서 히스토리를 읽고, 링크만 가진 키로 잠근 리포트(Report)를 올린 뒤 브라우저에서 링크를 엽니다. 링크는 4시간 동안 유효하며, 사이트(Site)는 저장한 내용을 읽을 수 없습니다.
2. **사이트에서.** GitHub로 로그인한 다음 아무 GitHub 사용자 이름을 입력하면 그 사람의 프로필(Profile)이 열립니다. 합계, 살아남은 줄(Surviving Lines), 유형(Archetype)과 업적(Achievements), 작업이 어디에 있는지, 임베드용 카드, 기간별 작업 증명(Proof of Work), Versus, Wrapped. 저장소 링크를 붙여 넣으면 그 리포트와 순위(Standings)를 볼 수 있고, 비공개를 포함한 내 저장소를 고를 수도 있습니다. 누구든 비교에서 빠질 수 있습니다.

프로젝트는 아직 초기 개발 단계입니다. CLI와 사이트는 처음부터 끝까지 동작합니다.

## 시작하기

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

`--no-open`은 브라우저를 열지 않고 링크만 출력하고, `--yes`는 묻지 않고 올립니다(스크립트용이며 브라우저를 열지 않습니다). `--expires 12`는 링크를 12시간 동안 유지합니다. `commitscape share --list`는 이 컴퓨터가 만든 링크를 보여 주고, `--delete <link>`는 그중 하나를 내립니다.

## 설치

| 방법 | 명령 |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape` 또는 `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket` 후 `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | [최신 릴리스](https://github.com/pixelactstudio/commitscape/releases/latest)의 `.deb`: `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | 최신 릴리스의 `.rpm`: `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| 바이너리 | 최신 릴리스에서 내 플랫폼용 압축 파일 |

미리 빌드한 바이너리는 x64와 ARM의 Linux(glibc 또는 musl), Intel과 Apple 실리콘의 macOS, x64의 Windows를 지원합니다. npm 패키지는 내 플랫폼의 바이너리만 설치하고, 설치할 때 아무것도 실행하지 않으며, 실행에 Node가 필요 없습니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `commitscape [path]` | `commitscape share`와 같음: 묻고, 잠근 리포트를 올리고, 링크를 연다 |
| `commitscape share [path]` | 이 저장소 리포트의 잠긴 링크. 어느 브라우저에서나 열린다. `--list`와 `--delete <link>`로 관리 |
| `commitscape surviving [path] --person <id>` | 한 사람의 살아남은 줄: head에 있는 줄 중 blame이 그 사람에게 돌리는 줄. 서식만 바꾼 커밋은 건너뛴다 |
| `commitscape health <owner/name>` | GitHub 프로젝트가 살아 있는지, 한 사람에게 의존하는지 |

어느 명령이든 `--help`를 붙이면 모든 옵션이 나옵니다.

## README에 카드 넣기

[card action](../../actions/card)은 사이트의 카드를 일정에 따라 내 저장소에 저장하고 최신으로 유지합니다.

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

사이트에 있는 카드의 주소를 바로 임베드할 수도 있습니다. 카드 스튜디오 `/u/<login>/cards`에서 카드마다 주소를 알려 줍니다. 카드는 로그인 없이 열리므로 README에 표시됩니다.

## 사이트에서

- **모든 공개 GitHub 저장소.** `/gh/<owner>/<name>`으로 가세요. GitHub 정보는 바로 보이고, 히스토리를 다 읽으면 리포트가 이어서 나옵니다. 대부분의 저장소는 몇 초면 됩니다. 변경된 줄(Lines Changed)은 그 뒤에, 기본 브랜치 것부터 채워집니다.
- **내 저장소.** 읽기만 할 수 있는 commitscape GitHub App으로 저장소를 고릅니다. 비공개 저장소의 리포트는 GitHub가 그 저장소를 볼 수 있다고 하는 사람에게만 보입니다.
- **누구나 열 수 있는 것.** 카드, 공유 리포트(Shared Report), 공유된 작업 증명. 그 밖의 모든 페이지는 GitHub 로그인을 요구하므로, 내가 여는 내용은 내 GitHub 사용 한도로 읽힙니다.
- **MCP 클라이언트용.** 사이트에 토큰이 설정되어 있으면 `/mcp`로 저장소를 찾고 그 리포트, 프로필, 순위를 읽을 수 있습니다.

사이트의 `/privacy`에는 무엇을, 어디에, 얼마 동안 보관하고 누가 읽을 수 있는지가 적혀 있습니다.

## 개인정보

내 컴퓨터에서 commitscape는 내가 "예"라고 하기 전에는 어떤 저장소도 어디에도 보내지 않습니다.

- `share`(와 인자 없는 `commitscape`)는 AES-256-GCM으로 암호화한 리포트를 올립니다. 키는 링크의 `#` 뒤에만 있고 브라우저는 그 부분을 보내지 않으므로, 사이트는 자신이 읽을 수 없는 것을 저장합니다. 이메일 주소는 절대 포함되지 않습니다.
- `surviving`은 내 컴퓨터에 있는 저장소를 읽습니다(GitHub 주소를 주면 그 저장소를 클론합니다). `health`는 [GitHub CLI](https://cli.github.com)를 통해 주어진 프로젝트에 대해 GitHub에 묻습니다.
- `share`, `health`, `surviving`, `report`를 실행할 때마다 익명 사용 집계 하나를 사이트로 보냅니다. 명령, 걸린 시간, 끝난 방식, 버전, 플랫폼을 무작위 ID로 보냅니다. 경로나 저장소의 내용은 절대 보내지 않습니다. `COMMITSCAPE_TELEMETRY=0` 또는 `DO_NOT_TRACK=1`로 끌 수 있습니다.
- 업데이트 확인은 없고, 설치할 때 아무것도 실행하지 않습니다.

사이트에서는 어떤 이메일 주소도 Builder 밖으로 나가지 않습니다. 엔진 서비스가 읽는 pack에도 들어 있지 않습니다.

## 어떻게 만들어졌나

git 히스토리를 읽는 것은 하나의 Rust 엔진입니다. 내 컴퓨터에서는 CLI 안에서, 사이트를 위해서는 Builder 안에서 동작합니다. 사이트 자체는 git을 실행하지 않습니다.

![누가 누구와 이야기하나: 사이트, 엔진 서비스, Builder, Postgres, R2, GitHub](../diagrams/system.svg)

- **사이트**(Node 위의 TanStack Start)는 로그인한 사람을 위해 모든 페이지를 서버에서 그립니다. 행 데이터와 빌드(Build) 대기열은 Postgres에, 파일은 R2에 두고, 저장소 히스토리를 훑어야 하는 질문은 모두 엔진 서비스에 묻습니다.
- **엔진 서비스(engine service)**(Rust, `apps/engine`)는 pack으로 답합니다. pack은 한 저장소의 한 head 시점 인덱스(Index)로, 빌드가 써 두고 그 뒤로는 바뀌지 않습니다. R2에서 한 번만 가져와 디스크와 메모리에 두기 때문에, 어떤 저장소의 어떤 기간(Window)이든 몇 밀리초면 답합니다.
- **Builder**는 대기열에서 빌드를 꺼내 저장소를 클론하고 `commitscape build`를 실행합니다.
- **랜딩 페이지**는 정적 페이지로, 사이트와 따로 Cloudflare Workers에 있습니다.

![빌드: 첫 리포트, 그다음 변경된 줄, 메인라인 먼저](../diagrams/build.svg)

콜드 빌드는 두 단계를 동시에 실행합니다. 옛 파일 내용이 없는 클론이 몇 초 만에 첫 리포트를 내고, 같은 엔진 캐시를 공유하는 전체 클론이 변경된 줄을 셉니다. 메인라인(Mainline)을 먼저, 최신 커밋부터, 시간 예산 안에서 세고, 남은 것은 뒤이어 조용히 도는 빌드가 맡습니다. 각 단계는 행 데이터를 Postgres의 저장 인덱스(Stored Index)에 복사하고 새 pack을 올리며, 엔진 서비스는 그 pack에 대한 첫 질문을 받을 때 가져옵니다.

![페이지 보기: 답이 어디서 오고 무엇이 보관되는가](../diagrams/read.svg)

페이지의 loader는 Postgres에서 pack의 키를 읽고, 그 키로 엔진 서비스에 묻고, 행 데이터(커밋 페이지, 브랜치, pull request)는 Postgres에서, 저장된 파일(파일 내용, Universe의 Atlas, 카드)은 R2에서 읽습니다. 답은 엔진 서비스에, 압축해서 사이트에도 보관됩니다. 공개 저장소에서 빌드에 고정된 주소는 1년 동안 캐시됩니다.

| 폴더 | 내용 |
|---|---|
| `crates/` | Rust: git을 읽는 엔진, 지표, 리포트, CLI |
| `apps/site/` | 사이트: Node 위의 TanStack Start, 서버 렌더링, Better Auth |
| `apps/engine/` | 엔진 서비스: pack으로 사이트의 질문에 답한다(axum, tokio) |
| `apps/builder/` | Builder: Postgres 대기열에서 빌드를 받아 저장소를 클론하고, `commitscape build`를 실행하고, 저장 인덱스를 Postgres에 적재하고, pack을 R2에 올린다 |
| `apps/landing/` | 랜딩 페이지: 빌드할 때 그리는 정적 HTML, Cloudflare Workers용 |
| `packages/server/` | 데이터베이스 스키마와 마이그레이션, R2 저장소, 대기열, 저장 인덱스 로더 |
| `packages/ui/` | 사이트가 보여 주는 모든 화면과 차트 |
| `packages/data/` | Rust에서 생성한 리포트 타입과 데이터 소스 |

아래 문서는 영어로 되어 있습니다.

- [도메인 용어](../../CONTEXT.md)
- [아키텍처 결정](../adr), 최신은 [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [각 부분이 함께 동작하는 방식](../working.md)
- [Postgres의 저장 인덱스](../index-in-postgres.md)
- [GitHub API 한도](../github-api.md)
- [배포](../../DEPLOY.md)
- [릴리스](../../RELEASING.md)

## 직접 호스팅

사이트, 엔진 서비스, Builder는 병합과 릴리스 때마다 Docker 이미지로 게시됩니다. [DEPLOY.md](../../DEPLOY.md)는 이것들을 Dokploy로 서버 한 대 또는 두 대에서 Postgres, Cloudflare R2 버킷, Cloudflare Workers의 랜딩 페이지와 함께 실행하는 방법을 설명합니다.

## 개발

필요한 것: Rust(stable), Node.js 24, pnpm 12, Docker.

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

`pnpm services`는 Docker에서 Postgres와 S3 대역을 띄웁니다. `apps/site/.env`에 `BETTER_AUTH_SECRET`을 설정하세요(`openssl rand -hex 32`). 사이트는 [http://localhost:3100](http://localhost:3100)에서, 엔진 서비스는 4100 포트에서 돌고, `pnpm dev:landing`은 [http://localhost:3200](http://localhost:3200)에 랜딩 페이지를 그립니다. GitHub 로그인, Sentry, PostHog는 키가 비어 있는 동안 꺼져 있습니다.

| 명령 | 용도 |
|---|---|
| `cargo test --workspace` | 모든 Rust 테스트. 엔진 서비스의 기준 답과의 비교 포함 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust 린트 |
| `cargo xtask check-layering` | crate들이 설계한 대로만 서로 의존하는지 확인 |
| `pnpm check` | 모든 TypeScript 패키지의 타입 검사, 린트, 테스트, 빌드 |
| `pnpm e2e` | Chromium에서 사이트, 엔진 서비스, Builder를 처음부터 끝까지. 접근성 검사 포함 |
| `pnpm db:generate` | 스키마 변경에 대한 마이그레이션 작성 |
| `cargo xtask bench` | 큰 저장소에서의 소요 시간 |

## 기술 스택

- Rust, gix, imara-diff. 엔진 서비스에는 axum과 tokio
- TanStack Start, React 19, TypeScript, Vite
- Astryx와 Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss, Cloudflare R2
- Better Auth, PostHog, Sentry
- Turborepo, oxlint, Vitest, Playwright

## 커밋 규칙

커밋과 pull request 제목은 [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다. 릴리스, 버전 번호, 변경 기록은 여기서 생성됩니다([RELEASING.md](../../RELEASING.md)).

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## 라이선스

commitscape는 오픈 소스 소프트웨어이며, [MIT License](../../LICENSE-MIT)와 [Apache License 2.0](../../LICENSE-APACHE) 중 원하는 쪽으로 사용할 수 있습니다. Copyright 2026 Dev Talan.

[Pixelact Studio](https://pixelactstudio.com)의 오픈 소스 프로젝트입니다.
