/** A Card image in the page's theme, in a box its exact size so nothing moves as it loads: the system's theme by itself, the one chosen on the page once its script runs. */
export function ThemedCard({ src, alt, width, height, query = "", className = "", eager = false }: { src: string; alt: string; width: number; height: number; query?: string; className?: string; eager?: boolean }) {
  const join = query ? `&${query}` : "";
  const light = `${src}.svg${query ? `?${query}` : ""}`;
  const dark = `${src}.svg?theme=dark${join}`;
  return (
    <span data-themed-card className={`themed-card relative block overflow-hidden rounded-2xl ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={dark} />
        <img src={light} data-light={light} data-dark={dark} alt={alt} width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async" className="block h-auto w-full" />
      </picture>
    </span>
  );
}
