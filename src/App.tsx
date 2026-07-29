import { useEffect, useState } from 'react'

import { gameData } from './data/constants'
import { Efficiency } from './features/Efficiency'
import { Logistics } from './features/Logistics'
import { Planner } from './features/Planner'
import { Power } from './features/Power'
import { Sink } from './features/Sink'
import { Unlocks } from './features/Unlocks'
import { useUnlocks } from './state/useUnlocks'

const TABS = [
  { id: 'planner', label: 'Planner' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'power', label: 'Power' },
  { id: 'logistics', label: 'Logistics' },
  { id: 'sink', label: 'Sink' },
  { id: 'unlocks', label: 'Unlocks' },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId {
  // The planner appends its shareable payload as `#planner:<data>`, so take the
  // part before the colon.
  const hash = window.location.hash.replace('#', '').split(':')[0] ?? ''
  return TABS.some((tab) => tab.id === hash) ? (hash as TabId) : 'planner'
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const unlocks = useUnlocks()

  // Keep the URL in step with the active tab so a tab is bookmarkable.
  useEffect(() => {
    const onHashChange = (): void => setTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const select = (id: TabId): void => {
    setTab(id)
    window.location.hash = id
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto max-w-[100rem] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-lg font-bold tracking-tight text-ficsit-500">
              Satisfactory Companion
            </h1>

            <nav className="flex flex-wrap gap-1">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => select(entry.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    tab === entry.id
                      ? 'bg-ficsit-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            <span className="ml-auto text-xs text-slate-600">
              game data v{gameData.gameVersion}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[100rem] px-4 py-4">
        {tab === 'planner' && <Planner unlocks={unlocks} />}
        {tab === 'efficiency' && <Efficiency />}
        {tab === 'power' && <Power unlocks={unlocks} />}
        {tab === 'logistics' && <Logistics />}
        {tab === 'sink' && <Sink unlocks={unlocks} />}
        {tab === 'unlocks' && <Unlocks unlocks={unlocks} />}
      </main>

      <footer className="mx-auto max-w-[100rem] px-4 pb-8 text-xs text-slate-600">
        <p>
          Recipe data from Satisfactory {gameData.gameVersion}. If a number looks off, check it
          against the in-game recipe screen — the game may have changed since this data was built.
        </p>
      </footer>
    </div>
  )
}
