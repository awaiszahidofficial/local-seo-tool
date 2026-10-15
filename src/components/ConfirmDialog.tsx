import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Alert } from './ui/Alert'
import { Button } from './ui/Button'

type ConfirmDialogProps = {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** Modal confirmation built on the native <dialog> element (focus trap, Escape, inert background). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Native Escape handling: let React state decide whether the dialog closes.
        event.preventDefault()
        if (!busy) onCancel()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      {open ? (
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <div className="mt-2 text-sm text-slate-600">{children}</div>
          {error ? <Alert variant="error" className="mt-4">{error}</Alert> : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  )
}
