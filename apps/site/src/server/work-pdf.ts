import "@tanstack/react-start/server-only";
import PDFDocument from "pdfkit";
import { cappedWords, groupWork, kindOf, leadingKinds, monthName, notable, percent, periodWords, workSummary, type Work, type WorkItem, type WorkKind } from "@commitscape/data";
import { INTER } from "@commitscape/ui/cards/fonts";

const font = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

const INK = "#17171a";
const SOFT = "#55544f";
const MUTED = "#8d8c86";
const LINE = "#e6e5df";
const WASH = "#f5f5f1";
const BRAND = "#0f7a37";
const ADDED = "#11733a";
const REMOVED = "#c9303a";
const WARN = "#9a5b00";

const KIND_COLOURS: Record<WorkKind, string> = { feature: "#2a78d6", fix: "#eb6834", refactor: "#1baf7a", docs: "#eda100", test: "#e87ba4", perf: "#4a3aa7", chore: "#8d8c86", other: "#c9c8c0" };

const SIDE = 50;
const TOP = 64;
const BOTTOM = 62;
const NOTABLE = 6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const grouped = (n: number) => n.toLocaleString("en-US");
const many = (n: number, one: string, more: string) => `${grouped(n)} ${n === 1 ? one : more}`;
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;
const ref = (i: WorkItem) => (i.kind === "pr" ? `#${i.number}` : (i.sha ?? "").slice(0, 7));
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** A Proof of Work as a PDF a hiring manager reads in half a minute: a summary page, the notable work by kind, then every item as an appendix. */
export function workPdf(work: Work, site: string): Promise<Uint8Array> {
  const name = work.name ?? work.login;
  const doc = new PDFDocument({ size: "A4", margins: { top: TOP, bottom: BOTTOM, left: SIDE, right: SIDE }, bufferPages: true, info: { Title: `Proof of Work: ${name}, ${work.from} to ${work.to}`, Author: name, Creator: "commitscape" } });
  doc.registerFont("text", font(INTER[400]));
  doc.registerFont("semi", font(INTER[600]));
  doc.registerFont("bold", font(INTER[700]));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks)))));

  const W = doc.page.width - SIDE * 2;
  const right = doc.page.width - SIDE;
  const floor = () => doc.page.height - BOTTOM;
  const period = periodWords(work.from, work.to);
  const where = work.filter ? `Only in ${work.filter}` : "Everywhere on GitHub";
  const summary = workSummary(work.items);
  const t = summary.totals;

  doc.on("pageAdded", () => {
    doc.save();
    doc.font("semi").fontSize(8).fillColor(MUTED).text(`${name} · Proof of Work`, SIDE, 30, { lineBreak: false });
    doc.font("text").text(period, SIDE, 30, { width: W, align: "right", lineBreak: false });
    doc.moveTo(SIDE, 44).lineTo(right, 44).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.restore();
    doc.x = SIDE;
    doc.y = TOP;
  });

  const ensure = (h: number) => {
    if (doc.y + h > floor()) doc.addPage();
  };
  const gap = (h: number) => {
    doc.y += h;
  };
  const write = (str: string, o: { f?: "text" | "semi" | "bold"; size?: number; colour?: string; x?: number; y?: number; width?: number; align?: "left" | "right" | "center"; link?: string; lineGap?: number; one?: boolean; spacing?: number }) => {
    doc
      .font(o.f ?? "text")
      .fontSize(o.size ?? 10)
      .fillColor(o.colour ?? INK)
      .text(str, o.x ?? SIDE, o.y ?? doc.y, { width: o.width ?? W, align: o.align ?? "left", link: o.link ?? null, lineGap: o.lineGap ?? 0, characterSpacing: o.spacing ?? 0, ...(o.one ? { lineBreak: false, ellipsis: true, height: (o.size ?? 10) * 1.4 } : {}) });
  };
  const lines = (added: number, removed: number, end: number, y: number, size: number, f: "text" | "semi" | "bold" = "semi", slash = false) => {
    doc.font(f).fontSize(size);
    const a = `+${compact(added)}`;
    const mid = slash ? " / " : "  ";
    const r = `−${compact(removed)}`;
    const wa = doc.widthOfString(a);
    const wm = doc.widthOfString(mid);
    const wr = doc.widthOfString(r);
    const x = end - wa - wm - wr;
    doc.fillColor(ADDED).text(a, x, y, { lineBreak: false });
    doc.fillColor(MUTED).text(mid, x + wa, y, { lineBreak: false });
    doc.fillColor(REMOVED).text(r, x + wa + wm, y, { lineBreak: false });
    return x;
  };
  const heading = (title: string, note?: string) => {
    ensure(40);
    const y = doc.y;
    write(title, { f: "bold", size: 12.5, y });
    if (note) write(note, { size: 8.5, colour: MUTED, y: y + 3, align: "right" });
    doc.y = y + 22;
  };

  doc.rect(0, 0, doc.page.width, 5).fill(BRAND);
  write("PROOF OF WORK", { f: "bold", size: 8.5, colour: BRAND, y: 46, spacing: 1.4 });
  gap(6);
  write(name, { f: "bold", size: 27 });
  gap(2);
  write(`@${work.login}   ·   ${period}   ·   ${where}`, { size: 10.5, colour: SOFT });
  if (work.scope === "self") {
    gap(3);
    write("Includes private repositories. Downloaded by its owner.", { size: 8.5, colour: MUTED });
  }
  gap(18);

  if (work.items.length === 0) {
    write("Nothing merged or committed in this period.", { f: "semi", size: 14 });
    gap(4);
    write(work.scope === "public" ? "Only public repositories count here. Try a longer period." : "Try a longer period.", { size: 10.5, colour: SOFT });
  } else {
    const lead = leadingKinds(summary);
    const span = days(work.from, work.to);
    write(
      `${many(t.prs, "pull request", "pull requests")} merged and ${many(t.commits, "commit", "commits")} across ${many(t.repositories, "repository", "repositories")}, on ${summary.activeDays} of the period's ${many(span, "day", "days")}.${lead ? ` The work is ${lead}.` : ""}`,
      { size: 13, lineGap: 3 },
    );
    const capped = cappedWords(work.capped);
    if (capped) {
      gap(6);
      write(capped, { size: 8.5, colour: WARN, lineGap: 1 });
    }
    gap(18);

    const tiles: { value: string; label: string; added?: number; removed?: number }[] = [
      { value: grouped(t.prs), label: "Pull requests merged" },
      { value: grouped(t.commits), label: "Commits" },
      { value: "", label: "Lines merged", added: t.additions, removed: t.deletions },
      { value: `${summary.activeDays}`, label: `Active days of ${span}` },
    ];
    const tw = (W - 3 * 10) / 4;
    const ty = doc.y;
    tiles.forEach((tile, i) => {
      const x = SIDE + i * (tw + 10);
      doc.roundedRect(x, ty, tw, 62, 6).fill(WASH);
      if (tile.added !== undefined) {
        doc.font("bold").fontSize(15);
        const wide = doc.widthOfString(`+${compact(tile.added)} / −${compact(tile.removed ?? 0)}`);
        lines(tile.added, tile.removed ?? 0, x + 12 + wide, ty + 13, 15, "bold", true);
      } else write(tile.value, { f: "bold", size: 21, x: x + 12, y: ty + 9, width: tw - 24 });
      write(tile.label, { size: 8, colour: SOFT, x: x + 12, y: ty + 40, width: tw - 24, one: true });
    });
    doc.y = ty + 62 + 26;

    heading("Kind of work", "from conventional prefixes and title words");
    const by = doc.y;
    doc.save();
    doc.roundedRect(SIDE, by, W, 12, 6).clip();
    let x = SIDE;
    for (const k of summary.kinds) {
      const w = Math.max(1.5, k.share * W);
      doc.rect(x, by, Math.max(0, w - 1.5), 12).fill(KIND_COLOURS[k.kind]);
      x += w;
    }
    doc.restore();
    doc.y = by + 22;
    const cw = (W - 2 * 18) / 3;
    const ly = doc.y;
    summary.kinds.forEach((k, i) => {
      const cx = SIDE + (i % 3) * (cw + 18);
      const cy = ly + Math.floor(i / 3) * 17;
      doc.roundedRect(cx, cy + 1.5, 7, 7, 1.5).fill(KIND_COLOURS[k.kind]);
      write(k.short, { size: 9, x: cx + 13, y: cy, width: cw - 70, one: true });
      write(`${grouped(k.count)}  ${percent(k.share)}`, { f: "semi", size: 9, colour: SOFT, x: cx, y: cy, width: cw, align: "right" });
    });
    doc.y = ly + Math.ceil(summary.kinds.length / 3) * 17 + 20;

    heading("Where the work went", many(t.repositories, "repository", "repositories"));
    const most = Math.max(1, ...summary.repositories.map((r) => r.items));
    for (const r of summary.repositories.slice(0, 5)) {
      ensure(28);
      const y = doc.y;
      write(r.repo, { f: "semi", size: 9.5, y, width: W - 170, one: true, link: r.private ? undefined : `https://github.com/${r.repo}` });
      const parts = [r.prs > 0 && many(r.prs, "pull request", "pull requests"), r.commits > 0 && many(r.commits, "commit", "commits"), r.private && "private"].filter(Boolean).join(" · ");
      write(parts, { size: 8.5, colour: SOFT, y: y + 1, align: "right" });
      doc.roundedRect(SIDE, y + 15, W, 3.5, 1.75).fill(WASH);
      doc.roundedRect(SIDE, y + 15, Math.max(3.5, (r.items / most) * W), 3.5, 1.75).fill(BRAND);
      doc.y = y + 27;
    }
    if (summary.repositories.length > 5) {
      write(`and ${many(summary.repositories.length - 5, "more repository", "more repositories")}, in the appendix`, { size: 8.5, colour: MUTED });
    }
    gap(18);

    if (summary.highlights.length > 0) {
      heading("Biggest contributions", "merged pull requests, by lines changed");
      for (const i of summary.highlights) highlight(i);
    }
  }

  function highlight(i: WorkItem) {
    const tw = W - 96;
    doc.font("semi").fontSize(9.5);
    const h = doc.heightOfString(i.title, { width: tw - 14 });
    ensure(h + 22);
    const y = doc.y;
    doc.circle(SIDE + 3, y + 5.5, 3).fill(KIND_COLOURS[kindOf(i.title)]);
    write(i.title, { f: "semi", size: 9.5, x: SIDE + 14, y, width: tw - 14, link: i.url });
    const meta = `${i.repo} ${ref(i)}${i.kind === "pr" ? `, merged ${day(i.at)}` : `, ${day(i.at)}`}`;
    write(meta, { size: 8, colour: SOFT, x: SIDE + 14, y: y + h + 2, width: tw - 14, one: true });
    if (i.additions !== null) lines(i.additions, i.deletions ?? 0, right, y + 1, 8.5);
    doc.y = y + h + 18;
  }

  if (work.items.length > 0) {
    doc.addPage();
    write("The work, by kind", { f: "bold", size: 19 });
    gap(4);
    write("The most telling of each kind: merged pull requests, largest first, then the newest commits. Every item is in the appendix.", { size: 9.5, colour: SOFT, lineGap: 1.5 });
    gap(16);
    for (const k of summary.kinds) {
      const { shown, total } = notable(work.items, k.kind, k.kind === "chore" || k.kind === "other" ? 3 : NOTABLE);
      ensure(70);
      const y = doc.y;
      doc.roundedRect(SIDE, y + 3, 9, 9, 2).fill(KIND_COLOURS[k.kind]);
      write(k.label, { f: "bold", size: 12.5, x: SIDE + 16, y });
      write(`${many(total, "item", "items")} · ${percent(k.share)}`, { size: 9, colour: SOFT, y: y + 3, align: "right" });
      doc.y = y + 20;
      doc.moveTo(SIDE, doc.y).lineTo(right, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
      gap(8);
      for (const i of shown) highlight(i);
      if (total > shown.length) write(`and ${many(total - shown.length, "more", "more")}, in the appendix`, { size: 8.5, colour: MUTED, x: SIDE + 14 });
      gap(16);
    }

    doc.addPage();
    write("Appendix: everything, by month", { f: "bold", size: 19 });
    gap(4);
    write(`${many(work.items.length, "item", "items")}. Pull requests on the day they were merged, commits on the day their author made them.`, { size: 9.5, colour: SOFT });
    gap(14);
    for (const m of groupWork(work.items)) {
      ensure(60);
      const items = m.repositories.flatMap((r) => r.items);
      const prs = items.filter((i) => i.kind === "pr").length;
      const y = doc.y;
      write(monthName(m.month), { f: "bold", size: 12, y });
      write([prs > 0 && many(prs, "pull request", "pull requests"), items.length - prs > 0 && many(items.length - prs, "commit", "commits")].filter(Boolean).join(" · "), { size: 8.5, colour: SOFT, y: y + 3, align: "right" });
      doc.y = y + 18;
      doc.moveTo(SIDE, doc.y).lineTo(right, doc.y).lineWidth(0.75).strokeColor(INK).stroke();
      gap(8);
      for (const r of m.repositories) {
        ensure(34);
        write(`${r.repo}${r.private ? "  (private)" : ""}`, { f: "semi", size: 9.5, link: r.private ? undefined : `https://github.com/${r.repo}` });
        gap(3);
        for (const i of r.items) {
          ensure(13);
          const ry = doc.y;
          write(ref(i), { size: 7.5, colour: MUTED, x: SIDE + 8, y: ry + 1, width: 44, one: true });
          write(i.title, { size: 8.5, x: SIDE + 54, y: ry, width: W - 54 - 110, one: true, link: i.url });
          write(day(i.at), { size: 7.5, colour: MUTED, x: right - 106, y: ry + 1, width: 36, align: "right", one: true });
          if (i.additions !== null) lines(i.additions, i.deletions ?? 0, right, ry + 1, 7.5, "text");
          doc.y = ry + 12.5;
        }
        gap(7);
      }
      gap(8);
    }
  }

  const range = doc.bufferedPageRange();
  const read = new Date(work.at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 38;
    doc.moveTo(SIDE, y - 8).lineTo(right, y - 8).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("text").fontSize(7.5).fillColor(MUTED).text(`Read from GitHub on ${read} · Made with commitscape · ${site.replace(/^https?:\/\//, "")}/u/${work.login}/work`, SIDE, y, { width: W - 80, lineBreak: false, link: `${site}/u/${work.login}/work` });
    doc.font("semi").text(`${p - range.start + 1} of ${range.count}`, SIDE, y, { width: W, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
