/**
 * Searchable recipe selector. There are 276 machine recipes, which is far too
 * many to scan in a plain dropdown.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { gameData, machineName, recipesById } from '../data/constants'
import type { Recipe, RecipeId } from '../data/types'

export function RecipePicker({
  value,
  onChange,
  recipes,
}: {
  value: RecipeId
  onChange: (recipe: RecipeId) => void
  recipes?: Recipe[]
}) {
  const pool = recipes ?? gameData.recipes
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name))
    if (!needle) return sorted.slice(0, 80)
    return sorted
      .filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          machineName(r.machine).toLowerCase().includes(needle),
      )
      // Standard recipes before alternates, then shortest name first, so
      // searching "iron ingot" surfaces the plain recipe rather than an alt.
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
        return aStarts - bStarts || Number(a.alternate) - Number(b.alternate) || a.name.length - b.name.length
      })
      .slice(0, 80)
  }, [query, pool])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Keep the keyboard selection in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const selected = recipesById.get(value)

  const commit = (recipe: Recipe): void => {
    onChange(recipe.className)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="recipe-picker-list"
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-ficsit-500 focus:ring-1 focus:ring-ficsit-500"
        value={open ? query : (selected?.name ?? '')}
        placeholder={selected ? selected.name : 'Search recipes…'}
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

      {!open && selected && (
        <p className="mt-1 text-xs text-slate-500">
          {machineName(selected.machine)}
          {selected.alternate && <span className="ml-2 text-sky-400">alternate recipe</span>}
        </p>
      )}

      {open && matches.length > 0 && (
        <ul
          id="recipe-picker-list"
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl"
        >
          {matches.map((recipe, index) => (
            <li key={recipe.className} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  index === highlighted ? 'bg-ficsit-600/30 text-ficsit-200' : 'text-slate-300'
                } hover:bg-ficsit-600/20`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => commit(recipe)}
              >
                <span className="truncate">
                  {recipe.name}
                  {recipe.alternate && <span className="ml-2 text-xs text-sky-400">alt</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {machineName(recipe.machine)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && matches.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-500">
          No recipe matches “{query}”.
        </div>
      )}
    </div>
  )
}
