import { useState } from "react";
import { useMode } from "@commitscape/ui";

/** A Card image in the page's own theme, in a box its exact size so nothing moves as it loads. */
export function ThemedCard({ src, alt, width, height, query = "", className = "", eager = false }: { src: string; alt: string; width: number; height: number; query?: string; className?: string; eager?: boolean }) {
  const [mode] = useMode();
  const [loaded, setLoaded] = useState(false);
  const join = query ? `&${query}` : "";
  const light = `${src}.svg${query ? `?${query}` : ""}`;
  const dark = `${src}.svg?theme=dark${join}`;
  const img = (url: string) => (
    <img
      src={url}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0) setLoaded(true);
      }}
      className={`block h-auto w-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
  return (
    <span className={`relative block overflow-hidden rounded-[18px] ${loaded ? "" : "bg-[var(--color-skeleton)]"} ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {mode === "light" ? (
        img(light)
      ) : mode === "dark" ? (
        img(dark)
      ) : (
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet={dark} />
          {img(light)}
        </picture>
      )}
    </span>
  );
}
