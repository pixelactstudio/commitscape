[English](../../README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [Deutsch](./README.de.md) · [Français](./README.fr.md) · **हिन्दी**

<div align="center">
  <img src="../../.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>आपने क्या बनाया है, साथ काम करने वालों के बीच आप कहाँ खड़े हैं, और इसे साझा करने के लिए कार्ड।</p>
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

commitscape किसी डेवलपर को दिखाता है कि उसने क्या बनाया है: मर्ज हुए pull request, दिए गए रिव्यू, और उसकी लिखी वे लाइनें जो आज भी चल रही हैं। यह सब हर रिपॉज़िटरी के अपने इतिहास से blame के ज़रिए गिना जाता है। यह दिखाता है कि वह अपने साथ काम करने वालों के बीच कहाँ खड़ा है, एक-एक पहलू करके, कभी एक अंक में जोड़कर नहीं, और इसे README, आत्म-मूल्यांकन या किसी पोस्ट के लिए कार्ड (Card) में बदल देता है। यह किसी बड़ी रिपॉज़िटरी का पूरा इतिहास git के अपने डेटा से कुछ ही सेकंड में पढ़ लेता है।

![commitscape की अपनी कहानी, commitscape द्वारा बनाई गई](../../.github/commitscape-card.svg)

इसे इस्तेमाल करने के दो तरीके हैं:

1. **अपने टर्मिनल से।** किसी भी git रिपॉज़िटरी में `npx commitscape` चलाइए। यह बताता है कि क्या अपलोड करेगा और पहले पूछता है (Enter का मतलब हाँ), आपकी मशीन पर इतिहास पढ़ता है, रिपोर्ट (Report) को ऐसी चाबी से लॉक करके अपलोड करता है जो सिर्फ़ लिंक में है, और लिंक आपके ब्राउज़र में खोल देता है। लिंक 4 घंटे चलता है, और साइट (Site) जो सँभालती है उसे पढ़ नहीं सकती।
2. **साइट पर।** GitHub से साइन इन कीजिए, फिर किसी भी GitHub यूज़रनेम को लिखकर उसकी प्रोफ़ाइल (Profile) देखिए: कुल आँकड़े, बची हुई लाइनें (Surviving Lines), आर्किटाइप (Archetype) और उपलब्धियाँ (Achievements), उसका काम कहाँ है, एम्बेड करने लायक कार्ड, किसी अवधि का काम का सबूत (Proof of Work), Versus और Wrapped। किसी रिपॉज़िटरी का लिंक चिपकाकर उसकी रिपोर्ट और रैंकिंग (Standings) देखिए, या अपनी रिपॉज़िटरी चुनिए, प्राइवेट भी। कोई भी तुलनाओं से बाहर रह सकता है।

प्रोजेक्ट अभी शुरुआती विकास में है। CLI और साइट शुरू से आख़िर तक काम करते हैं।

## शुरुआत

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

`--no-open` ब्राउज़र खोले बिना लिंक छापता है, `--yes` बिना पूछे अपलोड करता है (स्क्रिप्ट के लिए; यह कभी ब्राउज़र नहीं खोलता), और `--expires 12` लिंक को 12 घंटे तक चालू रखता है। `commitscape share --list` इस मशीन के बनाए लिंक दिखाता है और `--delete <link>` किसी एक को हटा देता है।

## इंस्टॉल

| कैसे | कमांड |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape`, या `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket`, फिर `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | [नवीनतम रिलीज़](https://github.com/pixelactstudio/commitscape/releases/latest) से `.deb`: `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | नवीनतम रिलीज़ से `.rpm`: `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| बाइनरी | नवीनतम रिलीज़ से आपके प्लेटफ़ॉर्म का आर्काइव |

पहले से बनी बाइनरी x64 और ARM पर Linux (glibc या musl), Intel और Apple silicon पर macOS, और x64 पर Windows के लिए उपलब्ध हैं। npm पैकेज सिर्फ़ आपके प्लेटफ़ॉर्म की बाइनरी इंस्टॉल करता है, इंस्टॉल के समय कुछ नहीं चलाता, और चलने के लिए उसे Node की ज़रूरत नहीं।

## कमांड

| कमांड | क्या करता है |
|---|---|
| `commitscape [path]` | `commitscape share` जैसा ही: पूछता है, लॉक की हुई रिपोर्ट अपलोड करता है और उसका लिंक खोलता है |
| `commitscape share [path]` | इस रिपॉज़िटरी की रिपोर्ट का लॉक किया हुआ लिंक, किसी भी ब्राउज़र के लिए; `--list` और `--delete <link>` उन्हें सँभालते हैं |
| `commitscape surviving [path] --person <id>` | किसी व्यक्ति की बची हुई लाइनें: head पर मौजूद वे लाइनें जो blame उसे देता है, सिर्फ़ फ़ॉर्मेटिंग वाले कमिट को पार करते हुए |
| `commitscape health <owner/name>` | कोई GitHub प्रोजेक्ट ज़िंदा है या नहीं, और क्या वह किसी एक व्यक्ति पर टिका है |

किसी भी कमांड के साथ `--help` सारे विकल्प दिखाता है।

## README में कार्ड

[card action](../../actions/card) साइट के कार्ड आपकी रिपॉज़िटरी में रखता है और तय समय पर उन्हें ताज़ा रखता है:

```yaml
- uses: pixelactstudio/commitscape/actions/card@v1
  with:
    cards: |
      u/octocat/totals?theme=dark .github/cards/totals.svg
```

या साइट से किसी कार्ड का पता सीधे एम्बेड कीजिए; `/u/<login>/cards` पर उसका कार्ड स्टूडियो हर कार्ड का पता देता है। कार्ड बिना साइन इन के खुलते हैं, इसलिए README उन्हें दिखा सकते हैं।

## साइट पर

- **कोई भी सार्वजनिक GitHub रिपॉज़िटरी।** `/gh/<owner>/<name>` पर जाइए। GitHub की जानकारी तुरंत दिखती है, और इतिहास पढ़ लिए जाने पर रिपोर्ट आ जाती है: ज़्यादातर रिपॉज़िटरी के लिए कुछ सेकंड। बदली गई लाइनें (Lines Changed) उसके बाद आती हैं, पहले डिफ़ॉल्ट ब्रांच की।
- **आपकी अपनी रिपॉज़िटरी।** commitscape के GitHub App से रिपॉज़िटरी चुनिए, जो सिर्फ़ पढ़ सकता है। किसी प्राइवेट रिपॉज़िटरी की रिपोर्ट सिर्फ़ उन्हीं को दिखती है जिन्हें GitHub के अनुसार वह रिपॉज़िटरी दिख सकती है।
- **सबके लिए खुला।** कार्ड, साझा रिपोर्ट (Shared Report) और साझा किए गए काम के सबूत। बाकी हर पेज के लिए GitHub से साइन इन करना होता है, ताकि आप जो खोलें वह आपके अपने GitHub कोटे से पढ़ा जाए।
- **MCP क्लाइंट के लिए।** जब साइट एक टोकन सेट करती है, तब `/mcp` किसी रिपॉज़िटरी को खोजता है और उसकी रिपोर्ट, प्रोफ़ाइल और रैंकिंग पढ़ता है।

साइट पर `/privacy` बताता है कि वह क्या रखती है, कहाँ, कितने समय तक, और उसे कौन पढ़ सकता है।

## निजता

आपकी मशीन पर, जब तक आप हाँ न कहें, commitscape कहीं कुछ नहीं भेजता:

- `share` (और अकेला `commitscape`) रिपोर्ट को AES-256-GCM से एन्क्रिप्ट करके अपलोड करता है। चाबी सिर्फ़ लिंक में `#` के बाद होती है, जिसे ब्राउज़र कभी नहीं भेजते, इसलिए साइट वह सँभालती है जिसे वह पढ़ नहीं सकती। इसमें कभी कोई ईमेल पता शामिल नहीं होता।
- `surviving` आपकी मशीन पर मौजूद रिपॉज़िटरी पढ़ता है (GitHub का पता देने पर वह उसे क्लोन करता है)। `health` [GitHub CLI](https://cli.github.com) के ज़रिए GitHub से उस प्रोजेक्ट के बारे में पूछता है जो उसे दिया गया है।
- कोई एनालिटिक्स नहीं, कोई अपडेट जाँच नहीं, और इंस्टॉल के समय कुछ नहीं चलता।

साइट पर कोई भी ईमेल पता Builder से बाहर नहीं जाता: इंजन सर्विस जिन pack से जवाब देती है उनमें एक भी नहीं होता।

## यह कैसे बना है

git इतिहास एक ही Rust इंजन पढ़ता है: आपकी मशीन पर CLI के अंदर, और साइट के लिए Builder के अंदर। साइट ख़ुद कभी git नहीं चलाती।

![कौन किससे बात करता है: साइट, इंजन सर्विस, Builder, Postgres, R2 और GitHub](../diagrams/system.svg)

- **साइट** (Node पर TanStack Start) साइन इन किए लोगों के लिए हर पेज सर्वर पर बनाती है। वह डेटा की पंक्तियाँ और बिल्ड (Build) की कतार Postgres में, और फ़ाइलें R2 में रखती है, और जिस भी सवाल के लिए किसी रिपॉज़िटरी का इतिहास खंगालना पड़े, वह इंजन सर्विस से पूछती है।
- **इंजन सर्विस (engine service)** (Rust, `apps/engine`) pack से जवाब देती है: हर pack किसी रिपॉज़िटरी का एक head पर इंडेक्स (Index) है, जिसे एक बिल्ड लिखता है और फिर कभी नहीं बदलता। वह R2 से pack एक ही बार लाती है और उसे डिस्क और मेमोरी में रखती है, इसलिए किसी भी रिपॉज़िटरी की कोई भी अवधि (Window) कुछ मिलीसेकंड लेती है।
- **Builder** कतार से बिल्ड लेता है, रिपॉज़िटरी क्लोन करता है और `commitscape build` चलाता है।
- **लैंडिंग पेज** स्थिर है, साइट से अलग, Cloudflare Pages पर।

![एक बिल्ड: पहले रिपोर्ट, फिर बदली गई लाइनें, मेनलाइन पहले](../diagrams/build.svg)

एक कोल्ड बिल्ड दो चरण एक साथ चलाता है। पुरानी फ़ाइल सामग्री के बिना वाला क्लोन कुछ सेकंड में पहली रिपोर्ट दे देता है; पूरा क्लोन, जो उसी इंजन कैश को साझा करता है, बदली गई लाइनें गिनता है: पहले मेनलाइन (Mainline), सबसे नए कमिट से शुरू करके, एक समय-सीमा के भीतर, और जो बचे उसे बाद में चुपचाप चलने वाले बिल्ड गिनते हैं। हर चरण अपनी पंक्तियाँ Postgres के स्टोर किए गए इंडेक्स (Stored Index) में कॉपी करता है और एक नया pack अपलोड करता है, और इंजन सर्विस उस pack के बारे में पहला सवाल आने पर उसे ले आती है।

![एक पेज देखना: जवाब कहाँ से आते हैं, और क्या रखा जाता है](../diagrams/read.svg)

किसी पेज का loader Postgres से pack की चाबी पढ़ता है, उसी के साथ इंजन सर्विस से पूछता है, और पंक्तियाँ (कमिट के पेज, ब्रांच, pull request) Postgres से तथा रखी गई फ़ाइलें (फ़ाइलों का टेक्स्ट, Universe का Atlas, कार्ड) R2 से पढ़ता है। जवाब इंजन सर्विस में, और कंप्रेस करके साइट में भी, रखे जाते हैं; किसी सार्वजनिक रिपॉज़िटरी के किसी बिल्ड पर टिके पते एक साल तक कैश रहते हैं।

| फ़ोल्डर | क्या है |
|---|---|
| `crates/` | Rust: git पढ़ने वाला इंजन, मेट्रिक्स, रिपोर्ट और CLI |
| `apps/site/` | साइट: Node पर TanStack Start, सर्वर पर रेंडर, Better Auth के साथ |
| `apps/engine/` | इंजन सर्विस: pack से साइट के सवालों का जवाब देती है (axum, tokio) |
| `apps/builder/` | Builder: Postgres की कतार से बिल्ड लेता है, रिपॉज़िटरी क्लोन करता है, `commitscape build` चलाता है, स्टोर किया गया इंडेक्स Postgres में लोड करता है और pack को R2 पर अपलोड करता है |
| `apps/landing/` | लैंडिंग पेज: बिल्ड के समय बना स्थिर HTML, Cloudflare Pages के लिए |
| `packages/server/` | डेटाबेस का स्कीमा और माइग्रेशन, R2 स्टोरेज, कतार और स्टोर किए गए इंडेक्स का लोडर |
| `packages/ui/` | साइट की हर स्क्रीन और चार्ट |
| `packages/data/` | Rust से बने रिपोर्ट के टाइप, और डेटा स्रोत |

ये दस्तावेज़ अंग्रेज़ी में हैं:

- [डोमेन की भाषा](../../CONTEXT.md)
- [आर्किटेक्चर के फ़ैसले](../adr), सबसे नया [ADR-0028](../adr/0028-the-engine-service-answers-from-immutable-packs.md)
- [हिस्से एक साथ कैसे काम करते हैं](../working.md)
- [Postgres में स्टोर किया गया इंडेक्स](../index-in-postgres.md)
- [GitHub API की सीमाएँ](../github-api.md)
- [डिप्लॉय करना](../../DEPLOY.md)
- [रिलीज़ करना](../../RELEASING.md)

## ख़ुद होस्ट करना

साइट, इंजन सर्विस और Builder हर मर्ज और हर रिलीज़ पर Docker इमेज के रूप में प्रकाशित होते हैं। [DEPLOY.md](../../DEPLOY.md) बताता है कि उन्हें Dokploy में एक या दो सर्वरों पर, Postgres, एक Cloudflare R2 बकेट और Cloudflare Pages पर लैंडिंग पेज के साथ कैसे चलाएँ।

## विकास

ज़रूरतें: Rust (stable), Node.js 24, pnpm 12 और Docker।

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

`pnpm services` Docker में Postgres और S3 का एक विकल्प चालू करता है। `apps/site/.env` में `BETTER_AUTH_SECRET` सेट कीजिए (`openssl rand -hex 32`)। साइट [http://localhost:3100](http://localhost:3100) पर चलती है, इंजन सर्विस पोर्ट 4100 पर, और `pnpm dev:landing` लैंडिंग पेज को [http://localhost:3200](http://localhost:3200) पर बनाता है। जब तक उनकी चाबियाँ ख़ाली हैं, GitHub साइन इन, Sentry और PostHog बंद रहते हैं।

| कमांड | काम |
|---|---|
| `cargo test --workspace` | सारे Rust टेस्ट, इंजन सर्विस के संदर्भ जवाबों समेत |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust लिंट |
| `cargo xtask check-layering` | जाँचता है कि crate एक-दूसरे पर सिर्फ़ तय तरीक़े से निर्भर हैं |
| `pnpm check` | हर TypeScript पैकेज का टाइप-चेक, लिंट, टेस्ट और बिल्ड |
| `pnpm e2e` | Chromium में साइट, इंजन सर्विस और Builder शुरू से आख़िर तक, एक्सेसिबिलिटी जाँच के साथ |
| `pnpm db:generate` | स्कीमा बदलाव के लिए माइग्रेशन लिखता है |
| `cargo xtask bench` | बड़ी रिपॉज़िटरी पर लगने वाला समय |

## तकनीक

- Rust, gix और imara-diff; इंजन सर्विस के लिए axum और tokio
- TanStack Start, React 19, TypeScript और Vite
- Astryx और Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss और Cloudflare R2
- Better Auth, PostHog और Sentry
- Turborepo, oxlint, Vitest और Playwright

## कमिट का तरीका

कमिट और pull request के शीर्षक [Conventional Commits](https://www.conventionalcommits.org/) का पालन करते हैं। रिलीज़, वर्ज़न नंबर और चेंजलॉग इन्हीं से बनते हैं ([RELEASING.md](../../RELEASING.md)):

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

<a name="license"></a>

## लाइसेंस

commitscape ओपन-सोर्स सॉफ़्टवेयर है, जो आपकी पसंद से [MIT License](../../LICENSE-MIT) या [Apache License 2.0](../../LICENSE-APACHE) के तहत उपलब्ध है। Copyright 2026 Dev Talan।

[Pixelact Studio](https://pixelactstudio.com) का एक ओपन-सोर्स प्रोजेक्ट।
