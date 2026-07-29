/** Searchable item selector — 152 items is too many for a plain dropdown. */
import { useEffect, useMemo, useRef, useState } from 'react'

import { gameData, itemsById } from '../data/constants'
import type { Item, ItemId } from '../data/types'

export function ItemPicker({
  value,
  onChange,
  items,
  placeholder = 'Search items…',
}: {
  value: ItemId | null
  onChange: (item: ItemId) => void
  items?: Item[]
  placeholder?: string
}) {
  const pool = items ?? gameData.items
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return pool.slice(0, 60)
    return pool
      .filter((item) => item.name.toLowerCase().includes(needle))
      // Prefix matches first — typing "iron" should surface Iron Ore before Steel Ingot.
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
        return aStarts - bStarts || a.name.length - b.name.length
      })
      .slice(0, 60)
  }, [query, pool])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const selected = value ? itemsById.get(value) : null

  const commit = (item: Item): void => {
    onChange(item.className)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-ficsit-500 focus:ring-1 focus:ring-ficsit-500"
        value={open ? query : (selected?.name ?? '')}
        placeholder={selected ? selected.name : placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlighted(0)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlighted(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlighted((h) => Math.min(h + 1, matches.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlighted((h) => Math.max(h - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const match = matches[highlighted]
            if (match) commit(match)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />

      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {matches.map((item, index) => (
            <li key={item.className}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                  index === highlighted ? 'bg-ficsit-600/30 text-ficsit-200' : 'text-slate-300'
                } hover:bg-ficsit-600/20`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => commit(item)}
              >
                <span>{item.name}</span>
                {item.liquid && <span className="text-xs text-sky-400">fluid</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
