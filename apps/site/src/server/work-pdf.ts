import "@tanstack/react-start/server-only";
import PDFDocument from "pdfkit";
import { groupWork, monthName, workSentence, type Work } from "@commitscape/data";
import { INTER } from "@commitscape/ui/cards/fonts";

const font = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

/** A Proof of Work as a PDF, for a client or a self-review. */
export function workPdf(work: Work, site: string): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Proof of Work: ${work.login}, ${work.from} to ${work.to}`, Author: work.name ?? work.login } });
  doc.registerFont("text", font(INTER[400]));
  doc.registerFont("bold", font(INTER[700]));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks)))));
  doc.font("bold").fontSize(20).fillColor("#1a1a19").text(`Proof of Work: ${work.name ?? work.login}`);
  doc.font("text").fontSize(11).fillColor("#62615c").text(`@${work.login} · ${work.from} to ${work.to}${work.filter ? ` · ${work.filter}` : ""}`);
  doc.moveDown(0.6);
  doc.fillColor("#1a1a19").fontSize(12).text(workSentence(work.items));
  for (const m of groupWork(work.items)) {
    doc.moveDown(1);
    doc.font("bold").fontSize(15).fillColor("#1a1a19").text(monthName(m.month));
    for (const r of m.repositories) {
      doc.moveDown(0.4);
      doc.font("bold").fontSize(11.5).fillColor("#1a1a19").text(`${r.repo}${r.private ? " (private)" : ""}`);
      for (const i of r.items) {
        const head = i.kind === "pr" ? `#${i.number} ` : `${(i.sha ?? "").slice(0, 7)} `;
        const tail = i.kind === "pr" ? `  merged ${i.at.slice(0, 10)} · +${i.additions ?? 0} −${i.deletions ?? 0}` : `  ${i.at.slice(0, 10)}`;
        doc.font("text").fontSize(9.5).fillColor("#8a8984").text(head, { indent: 10, continued: true });
        doc.fillColor("#1a1a19").text(i.title, { link: i.url, continued: true });
        doc.fillColor("#8a8984").text(tail, { link: null });
      }
    }
  }
  doc.moveDown(1.5);
  doc.font("text").fontSize(9).fillColor("#8a8984").text(`Made with commitscape: ${site}/u/${work.login}/work`);
  doc.end();
  return done;
}
