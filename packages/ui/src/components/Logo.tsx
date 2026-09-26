/** commitscape's mark: a small Map, three blocks of code. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="12" height="20" rx="2.5" fill="var(--s1)" />
      <rect x="15" y="1" width="6" height="11" rx="2" fill="var(--blue-2)" opacity="0.6" />
      <rect x="15" y="14" width="6" height="7" rx="2" fill="var(--s2)" />
    </svg>
  );
}
