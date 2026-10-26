[English](../../README.md) · [简体中文](./README.zh-CN.md) · **日本語** · [한국어](./README.ko.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [Deutsch](./README.de.md) · [Français](./README.fr.md) · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>あなたが作ってきたもの、一緒に働く人たちと比べた立ち位置、そしてそれを共有するためのカード。</p>
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

commitscape は、開発者が作ってきたものを見せます。マージされた pull request、行ったレビュー、そして今も動いている自分の書いた行を、各リポジトリ自身の履歴から blame で数えます。一緒に働く人たちと比べてどこに立っているかを、ひとつのスコアにまとめず観点ごとに示し、README や自己評価、投稿に使えるカード（Card）にします。大きなリポジトリの全履歴でも、git 自身のデータから数秒で読み取ります。

![commitscape 自身の物語を commitscape が描いたもの](../../.github/commitscape-card.svg)

使い方は二つあります。

1. **ターミナルから。** 任意の git リポジトリで `npx commitscape` を実行します。何をアップロードするかを伝えてから確認し（Enter で「はい」）、あなたのマシンで履歴を読み、リンクだけが持つ鍵でロックしたレポート（Report）をアップロードして、ブラウザでリンクを開きます。リンクは 4 時間有効で、サイト（Site）は保存した中身を読めません。
2. **サイトで。** GitHub でサインインし、任意の GitHub ユーザー名を入力するとその人のプロフィール（Profile）が開きます。合計値、生き残っている行（Surviving Lines）、アーキタイプ（Archetype）と実績（Achievements）、仕事がどこにあるか、埋め込み用のカード、期間を指定した仕事の証明（Proof of Work）、Versus、Wrapped。リポジトリのリンクを貼ればそのレポートと順位（Standings）が見られ、プライベートを含む自分のリポジトリを選ぶこともできます。誰でも比較から外れることができます。

プロジェクトはまだ初期開発の段階です。CLI とサイトはエンドツーエンドで動きます。

## はじめに

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

`--no-open` はブラウザを開かずにリンクを表示し、`--yes` は確認せずにアップロードします（スクリプト向けで、ブラウザは開きません）。`--expires 12` でリンクを 12 時間有効にします。`commitscape share --list` はこのマシンが作ったリンクを一覧し、`--delete <link>` でひとつを取り下げます。

## インストール

| 方法 | コマンド |
|---|---|
| npm | `npx commitscape`、`pnpm dlx commitscape`、または `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket` の後に `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian、Ubuntu | [最新リリース](https://github.com/pixelactstudio/commitscape/releases/latest)の `.deb`：`sudo apt install ./commitscape_*_amd64.deb` |
| Fedora、RHEL | 最新リリースの `.rpm`：`sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| バイナリ | 最新リリースから自分のプラットフォーム用のアーカイブ |

ビルド済みバイナリは、x64 と ARM の Linux（glibc または musl）、Intel と Apple シリコンの macOS、x64 の Windows に対応しています。npm パッケージは自分のプラットフォームのバイナリだけを入れ、インストール時に何も実行せず、動作に Node は要りません。

## コマンド

| コマンド | 内容 |
|---|---|
| `commitscape [path]` | `commitscape share` と同じ：確認し、ロックしたレポートをアップロードしてリンクを開く |
| `commitscape share [path]` | このリポジトリのレポートへのロックされたリンク。どのブラウザでも開ける。`--list` と `--delete <link>` で管理 |
| `commitscape surviving [path] --person <id>` | ある人の生き残っている行：head にある行のうち blame がその人に帰すもの。整形だけのコミットは素通りする |
| `commitscape health <owner/name>` | GitHub のプロジェクトが生きているか、一人に依存していないか |

どのコマンドでも `--help` で全オプションが表示されます。

## README にカードを

[card action](../../actions/card) は、サイトのカードをスケジュールに沿ってあなたのリポジトリに保存し、最新に保ちます。

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

サイト上のカードのアドレスを直接埋め込むこともできます。カードスタジオ `/u/<login>/cards` で各カードのアドレスがわかります。カードはサインインなしで開けるので、README に表示できます。

## サイトでできること

- **公開されている任意の GitHub リポジトリ。** `/gh/<owner>/<name>` を開きます。GitHub の情報はすぐに表示され、履歴を読み終えるとレポートが続きます。ほとんどのリポジトリは数秒です。変更行数（Lines Changed）はその後に、デフォルトブランチの分から埋まります。
- **自分のリポジトリ。** 読み取りしかできない commitscape の GitHub App でリポジトリを選びます。プライベートリポジトリのレポートは、GitHub がそのリポジトリを見られると判断した人にだけ表示されます。
- **誰でも開けるもの。** カード、共有レポート（Shared Report）、共有された仕事の証明。それ以外のページは GitHub でのサインインが必要で、開いたものはあなた自身の GitHub の利用枠で読まれます。
- **MCP クライアント向け。** サイトがトークンを設定していれば、`/mcp` でリポジトリを調べ、そのレポート、プロフィール、順位を読めます。

サイトの `/privacy` には、何をどこにどれだけの期間保存し、誰が読めるかが書かれています。

## プライバシー

あなたのマシンでは、あなたが「はい」と言うまで commitscape はリポジトリをどこにも送りません。

- `share`（と引数なしの `commitscape`）は AES-256-GCM で暗号化したレポートをアップロードします。鍵はリンクの `#` より後ろにしかなく、ブラウザはその部分を送らないので、サイトは自分で読めないものを保存します。メールアドレスは一切含まれません。
- `surviving` はあなたのマシン上のリポジトリを読みます（GitHub のアドレスを渡した場合はクローンします）。`health` は [GitHub CLI](https://cli.github.com) を通じて、渡されたプロジェクトについて GitHub に問い合わせます。
- `share`、`health`、`surviving`、`report` を実行するたびに、匿名の利用カウントを 1 件サイトに送ります。内容はコマンド、かかった時間、終わり方、バージョン、プラットフォームで、ランダムな ID で送ります。パスやリポジトリの中身は一切送りません。`COMMITSCAPE_TELEMETRY=0` か `DO_NOT_TRACK=1` で止められます。
- 更新チェックはなく、インストール時に何も実行しません。

サイトでは、メールアドレスは Builder の外に出ません。エンジンサービスが読む pack にも含まれていません。

## どう作られているか

git の履歴を読むのはひとつの Rust エンジンです。あなたのマシンでは CLI の中で、サイトのためには Builder の中で動きます。サイト自身は git を実行しません。

![誰が誰と話すか：サイト、エンジンサービス、Builder、Postgres、R2、GitHub](../diagrams/system.svg)

- **サイト**（Node 上の TanStack Start）は、サインインした人のためにすべてのページをサーバーで描画します。行データとビルド（Build）のキューは Postgres に、ファイルは R2 に置き、リポジトリの履歴をたどる必要がある問いはすべてエンジンサービスに尋ねます。
- **エンジンサービス（engine service）**（Rust、`apps/engine`）は pack から答えます。pack はあるリポジトリのある head におけるインデックス（Index）で、ビルドが書き出し、その後は変わりません。R2 から一度だけ取得してディスクとメモリに保持するので、どのリポジトリのどの期間（Window）でも数ミリ秒で答えます。
- **Builder** はキューからビルドを取り出し、リポジトリをクローンして `commitscape build` を実行します。
- **ランディングページ** は静的で、サイトとは別に Cloudflare Workers に置かれています。

![ビルド：まず最初のレポート、次に変更行数、メインライン優先](../diagrams/build.svg)

コールドビルドは二つのフェーズを同時に走らせます。古いファイル内容を含まないクローンが数秒で最初のレポートを出し、同じエンジンキャッシュを共有するフルクローンが変更行数を数えます。メインライン（Mainline）を先に、新しいコミットから、時間の予算内で数え、残りはその後に静かに走るビルドが引き受けます。各フェーズは行データを Postgres の保存インデックス（Stored Index）にコピーし、新しい pack をアップロードします。エンジンサービスはその pack について最初に尋ねられたときに取得します。

![ページの表示：答えがどこから来て、何が保持されるか](../diagrams/read.svg)

ページの loader は Postgres から pack のキーを読み、それを添えてエンジンサービスに尋ね、行データ（コミットのページ、ブランチ、pull request）は Postgres から、保存されたファイル（ファイルの本文、Universe の Atlas、カード）は R2 から読みます。答えはエンジンサービスに、圧縮してサイトにも保持されます。公開リポジトリでビルドに固定されたアドレスは 1 年間キャッシュされます。

| フォルダ | 内容 |
|---|---|
| `crates/` | Rust：git を読むエンジン、指標、レポート、CLI |
| `apps/site/` | サイト：Node 上の TanStack Start、サーバーレンダリング、Better Auth |
| `apps/engine/` | エンジンサービス：pack からサイトの問いに答える（axum、tokio） |
| `apps/builder/` | Builder：Postgres のキューからビルドを取り、リポジトリをクローンし、`commitscape build` を実行し、保存インデックスを Postgres に読み込み、pack を R2 にアップロードする |
| `apps/landing/` | ランディングページ：ビルド時に描く静的 HTML、Cloudflare Workers 用 |
| `packages/server/` | データベースのスキーマとマイグレーション、R2 ストレージ、キュー、保存インデックスのローダー |
| `packages/ui/` | サイトが表示するすべての画面とグラフ |
| `packages/data/` | Rust から生成したレポートの型と、データソース |

以下の文書は英語です。

- [ドメイン用語](../../CONTEXT.md)
- [アーキテクチャの決定](../adr)、最新は [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [各部分の連携](../working.md)
- [Postgres の保存インデックス](../index-in-postgres.md)
- [GitHub API の制限](../github-api.md)
- [デプロイ](../../DEPLOY.md)
- [リリース](../../RELEASING.md)

## セルフホスト

サイト、エンジンサービス、Builder は、マージとリリースのたびに Docker イメージとして公開されます。[DEPLOY.md](../../DEPLOY.md) では、それらを Dokploy で 1 台または 2 台のサーバーに載せ、Postgres、Cloudflare R2 のバケット、Cloudflare Workers 上のランディングページと組み合わせて動かす方法を説明しています。

## 開発

必要なもの：Rust（stable）、Node.js 24、pnpm 12、Docker。

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

`pnpm services` は Docker で Postgres と S3 の代役を起動します。`apps/site/.env` に `BETTER_AUTH_SECRET` を設定してください（`openssl rand -hex 32`）。サイトは [http://localhost:3100](http://localhost:3100)、エンジンサービスはポート 4100 で動き、`pnpm dev:landing` は [http://localhost:3200](http://localhost:3200) でランディングページを描きます。GitHub サインイン、Sentry、PostHog は、それぞれのキーが空のあいだは無効です。

| コマンド | 用途 |
|---|---|
| `cargo test --workspace` | すべての Rust テスト。エンジンサービスの正解データとの照合を含む |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust の lint |
| `cargo xtask check-layering` | crate 同士が設計どおりにだけ依存しているかを確認 |
| `pnpm check` | すべての TypeScript パッケージの型チェック、lint、テスト、ビルド |
| `pnpm e2e` | Chromium でサイト、エンジンサービス、Builder をエンドツーエンドで。アクセシビリティ検査付き |
| `pnpm db:generate` | スキーマ変更のマイグレーションを書き出す |
| `cargo xtask bench` | 大きなリポジトリでの所要時間 |

## 技術スタック

- Rust、gix、imara-diff。エンジンサービスには axum と tokio
- TanStack Start、React 19、TypeScript、Vite
- Astryx と Tailwind CSS
- PostgreSQL、Drizzle ORM、pg-boss、Cloudflare R2
- Better Auth、PostHog、Sentry
- Turborepo、oxlint、Vitest、Playwright

## コミットの流儀

コミットと pull request のタイトルは [Conventional Commits](https://www.conventionalcommits.org/) に従います。リリース、バージョン番号、変更履歴はそこから生成されます（[RELEASING.md](../../RELEASING.md)）。

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## ライセンス

commitscape はオープンソースソフトウェアで、[MIT License](../../LICENSE-MIT) と [Apache License 2.0](../../LICENSE-APACHE) のどちらかを選んで利用できます。Copyright 2026 Dev Talan.

[Pixelact Studio](https://pixelactstudio.com) によるオープンソースプロジェクトです。
