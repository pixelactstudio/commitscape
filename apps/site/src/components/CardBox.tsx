import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { markdownOf } from "#/lib/markdown";


/** One Card: both themes as they are served, its Markdown, a PNG, and links to post it. */
export function CardBox({ title, about, url, alt, link, share, width, height }: { title: string; about: string; url: string; alt: string; link: string; share: string; width: number; height: number }) {
  const [copied, setCopied] = useState(false);
  const markdown = markdownOf(url, alt, link);
  const copy = () => void navigator.clipboard?.writeText(markdown).then(() => setCopied(true));
  return (
    <section className="card-box" aria-label={title}>
      <div className="card-box-head">
        <div>
          <Heading level={2} className="figure-title">
            {title}
          </Heading>
          <p className="note small">{about}</p>
        </div>
        <div className="card-box-actions">
          <Button label={copied ? "Copied" : "Copy README Markdown"} variant="secondary" size="sm" onClick={copy} />
          <a className="card-link" href={`${url}.png`} download={`${alt}.png`}>
            Download PNG
          </a>
          <Button label="Post on X" variant="ghost" size="sm" href={`https://x.com/intent/post?text=${encodeURIComponent(share)}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" />
          <Button label="Post on LinkedIn" variant="ghost" size="sm" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" />
        </div>
      </div>
      <div className="card-box-pair">
        <img src={`${url}.svg`} alt={`${alt}, light`} width={width} height={height} loading="lazy" className="card-image" style={{ aspectRatio: `${width} / ${height}` }} />
        <img src={`${url}.svg?theme=dark`} alt={`${alt}, dark`} width={width} height={height} loading="lazy" className="card-image" style={{ aspectRatio: `${width} / ${height}` }} />
      </div>
      <pre className="card-markdown">{markdown}</pre>
    </section>
  );
}
