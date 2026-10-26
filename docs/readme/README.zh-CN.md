[English](../../README.md) · **简体中文** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [Deutsch](./README.de.md) · [Français](./README.fr.md) · [हिन्दी](./README.hi.md)

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>你做出了什么，你和一起工作的人相比如何，以及用来分享这一切的卡片。</p>
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

commitscape 让开发者看到自己做出了什么：合并的 pull request、给出的评审，以及至今仍在运行的那些代码行。这些都是用 blame 从每个仓库自己的历史里数出来的。它展示一个人和同事相比处在什么位置，一项一项地比，从不合成一个总分，并把结果做成卡片（Card），放进 README、自我评估或一篇帖子里。它直接读取 git 自己的数据，几秒钟就能读完一个大型仓库的全部历史。

![commitscape 自己的故事，由 commitscape 绘制](../../.github/commitscape-card.svg)

有两种用法：

1. **在终端里。** 在任意 git 仓库中运行 `npx commitscape`。它会先说明要上传什么并征求同意（回车表示同意），在你的机器上读取历史，把报告（Report）用只有链接才持有的密钥锁住后上传，并在浏览器中打开链接。链接有效期为 4 小时，网站（Site）无法读取它存下的内容。
2. **在网站上。** 用 GitHub 登录，然后输入任意 GitHub 用户名，查看此人的个人主页（Profile）：各项总数、存活行数（Surviving Lines）、类型（Archetype）与成就（Achievements）、作品分布在哪里、可嵌入的卡片、某段时间的工作证明（Proof of Work）、Versus 和 Wrapped。粘贴一个仓库链接即可看到它的报告和排名（Standings），也可以选择你自己的仓库，私有仓库也行。任何人都可以选择不参与比较。

项目仍处于早期开发阶段。CLI 和网站已经端到端可用。

## 快速开始

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

`--no-open` 只打印链接而不打开浏览器，`--yes` 不询问直接上传（用于脚本，它从不打开浏览器），`--expires 12` 让链接保留 12 小时。`commitscape share --list` 列出这台机器生成的链接，`--delete <link>` 撤下其中一个。

## 安装

| 方式 | 命令 |
|---|---|
| npm | `npx commitscape`、`pnpm dlx commitscape` 或 `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket`，然后 `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian、Ubuntu | 从[最新发布](https://github.com/pixelactstudio/commitscape/releases/latest)下载 `.deb`：`sudo apt install ./commitscape_*_amd64.deb` |
| Fedora、RHEL | 从最新发布下载 `.rpm`：`sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| 二进制文件 | 从最新发布下载适合你平台的压缩包 |

预编译的二进制文件覆盖 x64 和 ARM 上的 Linux（glibc 或 musl）、Intel 和 Apple 芯片上的 macOS，以及 x64 上的 Windows。npm 包只安装你所在平台的二进制文件，安装时不运行任何东西，运行时也不需要 Node。

## 命令

| 命令 | 作用 |
|---|---|
| `commitscape [path]` | 等同于 `commitscape share`：询问、上传锁定的报告并打开链接 |
| `commitscape share [path]` | 生成这个仓库报告的锁定链接，任何浏览器都能打开；`--list` 和 `--delete <link>` 用来管理 |
| `commitscape surviving [path] --person <id>` | 一个人的存活行数：blame 归给他的、仍在 head 上的行，格式化提交会被穿透 |
| `commitscape health <owner/name>` | 一个 GitHub 项目是否还活着，是否依赖某一个人 |

在任何命令后加 `--help` 可列出全部选项。

## README 里的卡片

[card action](../../actions/card) 会按计划把网站上的卡片保存到你的仓库里并保持更新：

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

也可以直接嵌入网站上卡片的地址；网站的卡片工作室 `/u/<login>/cards` 会给出每张卡片的地址。卡片无需登录即可打开，所以 README 能显示它们。

## 在网站上

- **任何公开的 GitHub 仓库。** 打开 `/gh/<owner>/<name>`。GitHub 上的信息会立刻显示，读完历史后报告随之出现：大多数仓库只需几秒。改动行数（Lines Changed）随后补上，默认分支的最先。
- **你自己的仓库。** 通过 commitscape 的 GitHub App 选择仓库，它只能读取。私有仓库的报告只展示给 GitHub 认定能看到该仓库的人。
- **对所有人开放。** 卡片、共享报告（Shared Report）和分享出来的工作证明。其他页面都要求先用 GitHub 登录，这样你打开的内容用的是你自己的 GitHub 额度。
- **给 MCP 客户端。** 网站设置了令牌后，`/mcp` 可以查找仓库，读取它的报告、个人主页和排名。

网站上的 `/privacy` 说明它保存什么、存在哪里、保存多久以及谁能读取。

## 隐私

在你的机器上，你同意之前 commitscape 不会把任何仓库发送到任何地方：

- `share`（以及单独的 `commitscape`）上传用 AES-256-GCM 加密的报告。密钥只在链接 `#` 之后的部分里，浏览器从不发送这部分，所以网站存的是它自己读不了的内容。报告中从不包含任何电子邮件地址。
- `surviving` 读取你机器上的仓库（如果给的是 GitHub 地址，就先克隆它）。`health` 通过 [GitHub CLI](https://cli.github.com) 向 GitHub 询问你给它的那个项目。
- 每次运行 `share`、`health`、`surviving` 或 `report`，都会向网站发送一条匿名使用计数：哪个命令、用了多久、结果如何、版本和你的平台，附带一个随机 ID。从不发送路径或仓库里的任何内容。设置 `COMMITSCAPE_TELEMETRY=0` 或 `DO_NOT_TRACK=1` 即可关闭。
- 没有更新检查，安装时也不运行任何东西。

在网站上，任何电子邮件地址都不会离开 Builder：引擎服务所读取的 pack 里一个也没有。

## 它是怎么构建的

同一个 Rust 引擎负责读取 git 历史：在你机器上的 CLI 里，以及为网站工作的 Builder 里。网站本身从不运行 git。

![谁和谁通信：网站、引擎服务、Builder、Postgres、R2 和 GitHub](../diagrams/system.svg)

- **网站**（TanStack Start，运行在 Node 上）在服务器端绘制每个页面，面向已登录的人。它把数据行和构建（Build）队列放在 Postgres，把文件放在 R2，凡是需要遍历仓库历史的问题都去问引擎服务。
- **引擎服务（engine service）**（Rust，`apps/engine`）根据 pack 作答：每个 pack 是一个仓库在某个 head 上的索引（Index），由一次构建写出，此后不再改变。它只从 R2 取一次 pack，并保留在磁盘和内存中，因此任何仓库的任意时间窗口（Window）都只需几毫秒。
- **Builder** 从队列里取出构建任务，克隆仓库，运行 `commitscape build`。
- **落地页** 是静态的，放在 Cloudflare Pages 上，与网站分开。

![一次构建：先出第一份报告，再算改动行数，主线优先](../diagrams/build.svg)

一次冷构建会同时运行两个阶段。不含旧文件内容的克隆在几秒内给出第一份报告；完整克隆共用同一个引擎缓存，负责统计改动行数：先算主线（Mainline），从最新的提交开始，在时间预算之内完成，剩下的交给随后安静运行的构建。每个阶段都会把数据行复制进 Postgres 中的存储索引（Stored Index），并上传一个新的 pack；引擎服务在第一次被问到时取回这个 pack。

![一次页面访问：答案从哪里来，哪些内容会被保留](../diagrams/read.svg)

页面的 loader 从 Postgres 读出 pack 的键，带着它去问引擎服务，再从 Postgres 读取数据行（提交分页、分支、pull request），从 R2 读取存储的文件（文件文本、Universe 的 Atlas、卡片）。答案会保留在引擎服务里，压缩后也保留在网站里；公开仓库中固定到某次构建的地址会缓存一年。

| 目录 | 内容 |
|---|---|
| `crates/` | Rust：读取 git 的引擎、各项指标、报告和 CLI |
| `apps/site/` | 网站：运行在 Node 上的 TanStack Start，服务端渲染，使用 Better Auth |
| `apps/engine/` | 引擎服务：根据 pack 回答网站的问题（axum、tokio） |
| `apps/builder/` | Builder：从 Postgres 队列取构建任务，克隆仓库，运行 `commitscape build`，把存储索引载入 Postgres，把 pack 上传到 R2 |
| `apps/landing/` | 落地页：构建时绘制的静态 HTML，用于 Cloudflare Pages |
| `packages/server/` | 数据库结构与迁移、R2 存储、队列，以及存储索引的加载器 |
| `packages/ui/` | 网站展示的每个界面和图表 |
| `packages/data/` | 从 Rust 生成的报告类型，以及数据源 |

以下文档为英文：

- [领域语言](../../CONTEXT.md)
- [架构决策](../adr)，最新的是 [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [各部分如何协作](../working.md)
- [Postgres 中的存储索引](../index-in-postgres.md)
- [GitHub API 的限制](../github-api.md)
- [部署](../../DEPLOY.md)
- [发布](../../RELEASING.md)

## 自行托管

网站、引擎服务和 Builder 在每次合并和每次发布时都会发布为 Docker 镜像。[DEPLOY.md](../../DEPLOY.md) 说明如何在 Dokploy 中运行它们：一台或两台服务器，加上 Postgres、一个 Cloudflare R2 存储桶，以及放在 Cloudflare Pages 上的落地页。

## 开发

需要：Rust（stable）、Node.js 24、pnpm 12 和 Docker。

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

`pnpm services` 在 Docker 中启动 Postgres 和一个 S3 替身。在 `apps/site/.env` 中设置 `BETTER_AUTH_SECRET`（`openssl rand -hex 32`）。网站运行在 [http://localhost:3100](http://localhost:3100)，引擎服务在 4100 端口，`pnpm dev:landing` 会在 [http://localhost:3200](http://localhost:3200) 绘制落地页。GitHub 登录、Sentry 和 PostHog 在对应的密钥为空时保持关闭。

| 命令 | 用途 |
|---|---|
| `cargo test --workspace` | 全部 Rust 测试，包括引擎服务的标准答案 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust 代码检查 |
| `cargo xtask check-layering` | 检查各个 crate 只按设计相互依赖 |
| `pnpm check` | 对每个 TypeScript 包做类型检查、代码检查、测试和构建 |
| `pnpm e2e` | 在 Chromium 中端到端测试网站、引擎服务和 Builder，含无障碍检查 |
| `pnpm db:generate` | 为数据库结构的改动生成迁移 |
| `cargo xtask bench` | 大型仓库上的耗时 |

## 技术栈

- Rust、gix 和 imara-diff；引擎服务用 axum 和 tokio
- TanStack Start、React 19、TypeScript 和 Vite
- Astryx 和 Tailwind CSS
- PostgreSQL、Drizzle ORM、pg-boss 和 Cloudflare R2
- Better Auth、PostHog 和 Sentry
- Turborepo、oxlint、Vitest 和 Playwright

## 提交规范

提交信息和 pull request 标题使用 [Conventional Commits](https://www.conventionalcommits.org/)。发布、版本号和更新日志都由它们生成（[RELEASING.md](../../RELEASING.md)）：

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## 许可证

commitscape 是开源软件，可任选 [MIT 许可证](../../LICENSE-MIT)或 [Apache 许可证 2.0](../../LICENSE-APACHE) 使用。版权所有 2026 Dev Talan。

[Pixelact Studio](https://pixelactstudio.com) 的开源项目。
