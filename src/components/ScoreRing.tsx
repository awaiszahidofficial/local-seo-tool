import { bandFor, BAND_LABELS } from '../lib/visibilityScore'

const BAND_STROKE = { strong: 'stroke-good', fair: 'stroke-warn', weak: 'stroke-bad' } as const

type ScoreRingProps = {
  value: number | null
  size?: number
  label: string
}

/** A 0–100 score as a ring. Colour shows the band; the number and band name are always written. */
export function ScoreRing({ value, size = 76, label }: ScoreRingProps) {
  const stroke = Math.max(5, Math.round(size / 12))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const band = value === null ? null : bandFor(value)
  const dash = value === null ? 0 : (Math.max(0, Math.min(100, value)) / 100) * circumference
  return (
    <div
      role="img"
      aria-label={value === null ? `${label}: not enough data yet` : `${label}: ${value} out of 100, ${BAND_LABELS[band ?? 'weak'].toLowerCase()}`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" focusable="false">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-line" />
        {band ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className={`${BAND_STROKE[band]} transition-[stroke-dasharray] duration-700 ease-out`}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none" aria-hidden="true">
        <span className="font-semibold text-ink tabular-nums" style={{ fontSize: size * 0.3 }}>
          {value === null ? '—' : value}
        </span>
      </span>
    </div>
  )
}
