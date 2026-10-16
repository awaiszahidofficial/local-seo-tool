import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_GROUPS } from '../lib/navigation'
import { chooseTheme, rememberProject } from '../lib/preferences'
import type { ProjectRow } from '../types/database'
import { Icon, type IconName } from './icons'

type Command = { id: string; label: string; hint: string; icon: IconName; run: () => void }

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  projects: readonly ProjectRow[]
  activeProjectId: string | null
}

/** Ctrl/⌘ + K: jump to any page or client, or switch theme, from the keyboard. */
export function CommandPalette({ open, onClose, projects, activeProjectId }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (path: string, scoped: boolean) => () => {
      navigate(scoped && activeProjectId ? `${path}?project=${activeProjectId}` : path)
    }
    const pages = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({
        id: `page:${item.to}`,
        label: item.label,
        hint: group.label,
        icon: item.icon,
        run: go(item.to, item.projectScoped === true),
      })),
    )
    const clients = projects.map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      hint: project.id === activeProjectId ? 'Current client' : 'Switch client',
      icon: 'folder' as IconName,
      run: () => {
        rememberProject(project.id)
        navigate(`/projects/${project.id}`)
      },
    }))
    const themes: Command[] = [
      { id: 'theme:dark', label: 'Dark theme', hint: 'Appearance', icon: 'moon', run: () => chooseTheme('dark') },
      { id: 'theme:light', label: 'Light theme', hint: 'Appearance', icon: 'sun', run: () => chooseTheme('light') },
      { id: 'theme:system', label: 'Match system theme', hint: 'Appearance', icon: 'monitor', run: () => chooseTheme('system') },
    ]
    return [...pages, ...clients, ...themes]
  }, [projects, activeProjectId, navigate])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(q))
  }, [commands, query])

  function close() {
    setQuery('')
    setActive(0)
    onClose()
  }

  function runAt(index: number) {
    const command = results[index]
    if (!command) return
    close()
    command.run()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command menu"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
      className="m-auto mt-[12vh] w-[min(36rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 border-b border-line-soft px-4">
        <Icon name="search" className="size-4 shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              runAt(active)
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-label="Search pages, clients and actions"
          placeholder="Jump to a page or client…"
          className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
        {results.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches “{query}”.</li>
        ) : (
          results.map((command, index) => (
            <li
              key={command.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setActive(index)}
              onClick={() => runAt(index)}
              className={[
                'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                index === active ? 'bg-accent-soft text-ink' : 'text-ink-2',
              ].join(' ')}
            >
              <Icon name={command.icon} className={`size-4 shrink-0 ${index === active ? 'text-accent-ink' : 'text-ink-3'}`} />
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              <span className="shrink-0 text-xs text-ink-3">{command.hint}</span>
            </li>
          ))
        )}
      </ul>
    </dialog>
  )
}
