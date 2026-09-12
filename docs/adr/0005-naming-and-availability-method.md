# Naming: the availability method, and the shortlist

`codescope` and then `gitgeist` were both killed by collisions found *after* they had been written into documents. The first check was too narrow. This records the corrected method and the five candidates that survive it. No name is registered until one is picked.

## Status

accepted — `commitscape` selected 2026-09-12

## Context

Two names died in two rounds:

- **`codescope`** — held on crates.io by a tool described as *"a terminal-native code review workspace for understanding Git changes and their system impact,"* published six days before we looked. Caught by the registry check.
- **`gitgeist`** — crates.io and npm were both clear, so it passed. It should not have. `gitgeistai/gitgeist-ai` is an active AI git-management tool doing commit generation and semantic analysis, squarely our category. Missed because the check never looked at GitHub.

The lesson is not "check GitHub too." It is that **registry availability and category availability are different questions**, and only the second one matters. A free crates.io name whose GitHub namespace belongs to a competitor is not available; it is a collision with extra steps.

## Decision

A name is available only when **all four** clear:

1. **crates.io** — no crate of that name.
2. **npm** — no package of that name, *and* the `@name` scope holds no packages. The scope matters because the distribution model in ADR-0003 publishes six scoped platform packages; losing the scope breaks the release shape even if the bare name is free.
3. **GitHub** — the `github.com/<name>` namespace resolves to neither a user nor an organization, *and* no existing repository of that exact name occupies our category.
4. **Plain web search** — nothing in the developer-tool space uses the name, including things too new or too small to appear in any registry.

Check 3 is run through the authenticated GitHub API rather than a search engine, because search engines under-report and the namespace question in particular needs an authoritative 404.

Check 4 is not a formality. It is the only check that catches a funded product with a landing page and no public repo.

### What the method rejected

Applying all four to a pool of twenty-two candidates eliminated seventeen:

| Rejected | Failed on |
|---|---|
| `codescope` | crates.io — direct category competitor |
| `gitgeist` | GitHub — `gitgeistai/gitgeist-ai`, AI git tooling |
| `strata`, `caldera`, `epicenter`, `augur`, `tephra`, `faultline`, `lodestone`, `dowser`, `sediment`, `palimpsest`, `hindcast` | crates.io |
| `stratigraph` | npm — an existing tool doing *"hotspots and grounded structural findings from source and git history"* |
| `outcrop`, `loadbearing`, `codeseam`, `gitstrata`, `codestrata`, `faultmap`, `stratamap`, `plumbline`, `bellwether` | GitHub namespace taken |
| `churnmap` | GitHub — two repos doing git co-change analysis |
| `churnwise` | GitHub — eight name-collisions in ML churn prediction |
| `blastradius` | web — an established Terraform graph visualizer |

Three of these (`stratigraph`, `churnmap`, `gitstrata`) were free on at least one registry while being occupied by a tool in our exact category. That is the failure mode the old method could not see.

### The five survivors

All five clear crates.io, npm name, npm scope, GitHub namespace, GitHub exact-name repositories, and web search.

| Candidate | Note |
|---|---|
| `commitscape` | Zero GitHub repos of the name. Clean web results. |
| `repostrata` | Zero GitHub repos. Web results are unrelated taxonomy and repost tooling. |
| `hotstrata` | Zero GitHub repos. Only web hit is an unrelated painting. |
| `churnstrata` | Zero GitHub repos. Web results are customer-churn SaaS. |
| `churnscape` | Zero GitHub repos. Web results are customer-churn SaaS. |

### Selected: `commitscape`

Chosen for two reasons. It is the only survivor that is not a compound of a metric name, so it still fits when v0.3 takes the tool into agent-era metrics that `churn-` and `-strata` would not describe. And its search neighbourhood is clean — nearest hits are cash-flow and mining-operations SaaS, no developer-tool overlap — whereas both `churn*` candidates would have competed for their own query against a well-funded adjacent industry.

## Consequences

- The two `churn*` names inherit a crowded SEO neighbourhood: searching either surfaces pages of customer-retention SaaS. The name is unclaimed but the *search term* is not, which is a discoverability cost that registry checks cannot detect. This is a point against them that only check 4 reveals.
- npm scope emptiness is inferred from the registry search API returning zero packages. An organization can exist while publishing nothing public, so the scope must still be confirmed at publish time with an authenticated request.
- Availability was verified 2026-09-12. Registries move, and both prior collisions were published within weeks of being checked. Re-verify immediately before first registration.
- All four checks run again before any future rename. The cost of this pass is minutes; the cost of skipping check 3 was an ADR, a glossary, and a distribution document written against a dead name.
