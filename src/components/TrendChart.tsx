import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../lib/format'
import { niceMax, type DailyPoint } from '../lib/gscAnalysis'

type Metric = 'clicks' | 'impressions'

type TrendChartProps = {
  current: readonly DailyPoint[]
  previous: readonly DailyPoint[]
  metric: Metric
  label: string
}

const HEIGHT = 220
const PAD = { top: 12, right: 12, bottom: 28, left: 44 }
const integer = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next) setWidth(Math.max(280, Math.round(next)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function shortDate(date: string): string {
  return formatDate(date, { timeZone: 'UTC' }).replace(/, \d{4}$/, '')
}

/**
 * Daily trend for this period against the previous one (aligned by day number), on one axis.
 * Hover or focus to read exact values; the same numbers are in the table below the chart.
 */
export function TrendChart({ current, previous, metric, label }: TrendChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const days = current.length
  const values = (series: readonly DailyPoint[]) => series.map((point) => point[metric])
  const now = values(current)
  const before = values(previous).slice(0, days)
  const max = niceMax(Math.max(1, ...now, ...before))
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (index: number) => PAD.left + (days <= 1 ? plotW / 2 : (index / (days - 1)) * plotW)
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH
  const path = (series: readonly number[]) => series.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('')
  const area = `${path(now)}L${x(now.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
  const ticks = [0, max / 2, max]
  const xLabels = days > 2 ? [0, Math.floor((days - 1) / 2), days - 1] : [0, days - 1]

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const position = ((event.clientX - rect.left) / rect.width) * width
    const index = Math.round(((position - PAD.left) / plotW) * (days - 1))
    setHover(Math.max(0, Math.min(days - 1, index)))
  }

  if (days === 0) return <p className="py-10 text-center text-sm text-ink-3">No daily data for this period.</p>

  const point = hover === null ? null : current[hover]
  const prevPoint = hover === null ? null : previous[hover]
  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 80, 0), width - 170)

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-0.5 w-4 rounded bg-accent" />
          This period
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-ink-3" />
          Previous period
        </span>
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`${label}: daily ${metric} for this period and the previous one`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(days - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setHover((value) => Math.max(0, (value ?? days - 1) - 1))
            if (event.key === 'ArrowRight') setHover((value) => Math.min(days - 1, (value ?? 0) + 1))
          }}
          className="block touch-none overflow-visible focus-visible:outline-2 focus-visible:outline-accent"
        >
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="[stop-color:var(--c-accent)]" stopOpacity="0.22" />
              <stop offset="100%" className="[stop-color:var(--c-accent)]" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line-soft" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-3 text-[11px] tabular-nums">
                {compact.format(tick)}
              </text>
            </g>
          ))}
          {xLabels.map((index) => (
            <text key={index} x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? 'start' : index === days - 1 ? 'end' : 'middle'} className="fill-ink-3 text-[11px]">
              {current[index] ? shortDate(current[index].date) : ''}
            </text>
          ))}
          <path d={area} fill="url(#trend-fill)" />
          {before.length > 1 ? <path d={path(before)} fill="none" className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" /> : null}
          <path d={path(now)} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-line-strong" strokeWidth={1} />
              {before[hover] !== undefined ? <circle cx={x(hover)} cy={y(before[hover] ?? 0)} r={4} className="fill-ink-3 stroke-surface" strokeWidth={2} /> : null}
              <circle cx={x(hover)} cy={y(now[hover] ?? 0)} r={4.5} className="fill-accent stroke-surface" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {point ? (
          <div className="pointer-events-none absolute top-0 w-[170px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: tooltipLeft }}>
            <p className="font-medium text-ink">{formatDate(point.date, { timeZone: 'UTC' })}</p>
            <p className="mt-1 flex justify-between text-ink-2">
              <span>This period</span>
              <span className="font-medium text-ink tabular-nums">{integer.format(point[metric])}</span>
            </p>
            {prevPoint ? (
              <p className="flex justify-between text-ink-2">
                <span>{shortDate(prevPoint.date)}</span>
                <span className="tabular-nums">{integer.format(prevPoint[metric])}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <details className="mt-3 text-xs text-ink-3">
        <summary className="cursor-pointer hover:text-ink-2">Show the numbers</summary>
        <div className="mt-2 max-h-60 overflow-y-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Daily {metric}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 font-medium">Date</th>
                <th scope="col" className="py-1 text-right font-medium">This period</th>
                <th scope="col" className="py-1 text-right font-medium">Previous</th>
              </tr>
            </thead>
            <tbody>
              {current.map((day, index) => (
                <tr key={day.date} className="border-t border-line-soft">
                  <td className="py-1">{shortDate(day.date)}</td>
                  <td className="py-1 text-right tabular-nums">{integer.format(day[metric])}</td>
                  <td className="py-1 text-right tabular-nums">{previous[index] ? integer.format(previous[index][metric]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
