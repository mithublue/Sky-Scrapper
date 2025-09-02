"use client"

import React from 'react'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

type Mode = 'single' | 'list'

type Result = { ok: boolean; data?: any; count?: number; error?: string; mode?: Mode }

export default function ScrapeForm() {
  const [url, setUrl] = React.useState<string>('')
  const [mode, setMode] = React.useState<Mode>('list')
  const [listItemSelector, setListItemSelector] = React.useState<string>('')
  const [limit, setLimit] = React.useState<number | ''>('')
  const [deepSearch, setDeepSearch] = React.useState<boolean>(false)
  const [detailUrlFieldName, setDetailUrlFieldName] = React.useState<string>('')
  const [fields, setFields] = React.useState<Field[]>([
    { name: 'title', selector: '', type: 'text' },
  ])
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<Result | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const bookingDemo = () => {
    setUrl('https://www.booking.com/searchresults.html?ss=Saudi+Arabia&ssne=Saudi+Arabia&ssne_untouched=Saudi+Arabia&label=gen173nr-10CAEoggI46AdIM1gEaBSIAQGYATO4ARfIAQzYAQPoAQH4AQGIAgGoAgG4AoDA1sUGwAIB0gIkOWY5ZTg1MmItODlkMi00NTYxLTg5MjUtNTIyMWRjYjg1NDRj2AIB4AIB&aid=304142&lang=en-us&sb=1&src_elem=sb&src=index&dest_id=186&dest_type=country&group_adults=2&no_rooms=1&group_children=0')
    setMode('list')
    setListItemSelector('div[data-testid="property-card"]')
    setFields([
      { name: 'name', selector: 'div[data-testid="title"]', type: 'text' },
      { name: 'link', selector: 'a[data-testid="title-link"]', type: 'attr', attr: 'href' },
      { name: 'price', selector: 'span[data-testid="price-and-discounted-price"]', type: 'text' },
      { name: 'rating', selector: 'div[data-testid="review-score"] div', type: 'text' },
    ])
    setDeepSearch(false)
    setDetailUrlFieldName('link')
  }

  const addField = () => setFields(prev => [...prev, { name: '', selector: '', type: 'text' }])
  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx))
  const updateField = (idx: number, patch: Partial<Field>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const payload = {
        url,
        mode,
        listItemSelector: mode === 'list' ? listItemSelector : undefined,
        fields,
        limit: mode === 'list' && typeof limit === 'number' ? limit : undefined,
        deepSearch: mode === 'list' ? deepSearch : undefined,
        detailUrlFieldName: mode === 'list' && deepSearch ? detailUrlFieldName : undefined,
      }
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Request failed')
      setResult(json)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const copyResult = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.data, null, 2))
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={bookingDemo} className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700">Load Booking.com demo</button>
        <span className="text-sm text-gray-500">Prefills selectors for the provided Booking.com URL</span>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="md:col-span-2">
            <div className="mb-1 text-sm font-medium">URL</div>
            <input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200" />
          </label>
          <label>
            <div className="mb-1 text-sm font-medium">Mode</div>
            <select value={mode} onChange={e => setMode(e.target.value as Mode)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200">
              <option value="single">Single</option>
              <option value="list">List (loop)</option>
            </select>
          </label>
        </div>

        {mode === 'list' && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="md:col-span-2">
                <div className="mb-1 text-sm font-medium">List item selector</div>
                <input required value={listItemSelector} onChange={e => setListItemSelector(e.target.value)} placeholder="CSS selector for each item (e.g. div.card)" className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200" />
              </label>
              <label>
                <div className="mb-1 text-sm font-medium">Max items (optional)</div>
                <input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') return setLimit('')
                    const num = Number(v)
                    setLimit(Number.isFinite(num) && num > 0 ? Math.floor(num) : '')
                  }}
                  placeholder="e.g. 20"
                  className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 md:col-span-2">
                <input
                  type="checkbox"
                  checked={deepSearch}
                  onChange={e => setDeepSearch(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium">Deep Search (open each item's URL and scrape detail page)</span>
              </label>
              <label>
                <div className="mb-1 text-sm font-medium">Detail URL field</div>
                <select
                  value={detailUrlFieldName}
                  onChange={e => setDetailUrlFieldName(e.target.value)}
                  disabled={!deepSearch}
                  className="w-full rounded border px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">Select field containing URL</option>
                  {fields.map((f) => (
                    <option key={f.name || Math.random()} value={f.name}>{f.name || '(unnamed field)'}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">Choose the field whose value is the link to the detail page (e.g., "link").</p>
              </label>
            </div>
          </>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Fields</div>
            <button type="button" onClick={addField} className="rounded border px-2 py-1 text-sm hover:bg-gray-50">+ Add field</button>
          </div>
          {fields.map((f, idx) => (
            <div key={idx} className="grid items-end gap-2 md:grid-cols-12">
              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-gray-600">Name</div>
                <input value={f.name} onChange={e => updateField(idx, { name: e.target.value })} placeholder="e.g. title" className="w-full rounded border px-2 py-1.5" />
              </label>
              <label className="md:col-span-6">
                <div className="mb-1 text-xs text-gray-600">Selector</div>
                <input value={f.selector} onChange={e => updateField(idx, { selector: e.target.value })} placeholder="e.g. h2.title" className="w-full rounded border px-2 py-1.5" />
              </label>
              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-gray-600">Type</div>
                <select value={f.type} onChange={e => updateField(idx, { type: e.target.value as Field['type'] })} className="w-full rounded border px-2 py-1.5">
                  <option value="text">text</option>
                  <option value="attr">attr</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-gray-600">Attr (if type=attr)</div>
                <input value={f.attr || ''} onChange={e => updateField(idx, { attr: e.target.value })} placeholder="e.g. href, src" className="w-full rounded border px-2 py-1.5" />
              </label>
              <div className="md:col-span-12">
                <button type="button" onClick={() => removeField(idx)} className="text-xs text-red-600 hover:underline">Remove</button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button disabled={loading} type="submit" className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Scraping…' : 'Scrape'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      {result && (
        <div className="space-y-2 rounded border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Result {result.mode === 'list' && typeof result.count === 'number' ? `(${result.count} items)` : ''}</div>
            <button onClick={copyResult} className="rounded border px-2 py-1 text-sm hover:bg-gray-50">Copy JSON</button>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
