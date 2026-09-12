# Author identity comes from mailmap plus two rules, and nothing else is merged silently

We resolve a person's several git identities using the repository's own `.mailmap`, plus exactly two narrow normalizations. Identities we merely *suspect* are the same person are surfaced to the user, never merged.

## Status

accepted

## Context

Bus factor is the metric where being wrong is most damaging: it is the number most likely to be quoted in a meeting, and a silently wrong merge either invents a single owner where there are three, or hides a genuine single point of failure. It is also the metric most exposed to identity fragmentation, since the same person routinely commits as three different name-and-email pairs across a laptop, a work machine, and a web edit.

The tempting fix is transitive merging — union identities that share either a name or an email. It catches the most real duplicates and it is wrong in exactly the worst way: shared values like `root`, `dev@localhost`, `builder`, or a common display name fuse genuinely distinct people into one, and the resulting bus factor is confidently incorrect with no visible signal that anything happened.

`gix-mailmap` is listed complete upstream, and `.mailmap` is git's own mechanism for precisely this problem — declared by the repository's owners, versioned alongside the code, and inspectable by anyone who doubts a number.

## Decision

Resolution proceeds in this order and stops:

1. **`.mailmap`**, honoured exactly as git defines it.
2. **Case-insensitive email equality** — `Dev@Example.com` and `dev@example.com` are one person.
3. **GitHub noreply normalization** — `12345+octocat@users.noreply.github.com` resolves to the same identity as `octocat@users.noreply.github.com`.

Nothing else merges. Identities that look related under weaker signals — same display name, different domains; same email local-part — are collected and offered as a **suspected duplicates** hint, with the action being "add these lines to your `.mailmap`."

## Consequences

- Repositories without a `.mailmap` will show fragmented authors on first run, and bus factor will read *more* optimistic than reality. This is the correct direction to be wrong in: it under-claims rather than inventing certainty, and the duplicates hint tells the user why.
- Turning the hint into a `.mailmap` improves every subsequent run, for every tool that reads mailmap, not just ours. We are pushing users toward a fix that outlives us.
- Rules 2 and 3 are safe because both are identity-preserving by construction — neither can fuse two people who were ever distinct.
- The hint is a panel that has to be designed, not just a log line. It is the only place the tool admits uncertainty about a number, and it should read as helpful rather than as a defect report.
