/** The Local SEO Workbench mark: a map pin whose head is a search ring. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`.trim()}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path d="M16 26.5s-7-5.6-7-11.4a7 7 0 0 1 14 0c0 5.8-7 11.4-7 11.4z" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="16" cy="15" r="2.6" fill="white" />
      </svg>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ink">Local SEO</span>
        <span className="block text-xs text-ink-3">Workbench</span>
      </span>
    </span>
  )
}
