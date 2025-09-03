"use client"

import React from 'react'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

type Result = { ok: boolean; data?: any; count?: number; error?: string; mode?: 'single' | 'list' }

type Suggestion = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
  confidence: number
  source: string
}

export default function ScrapeForm() {
  const [url, setUrl] = React.useState<string>('')
  const [listItemSelector, setListItemSelector] = React.useState<string>('')
  const [limit, setLimit] = React.useState<number | ''>('')
  const [offset, setOffset] = React.useState<number | ''>('')
  const [fields, setFields] = React.useState<Field[]>([
    { name: 'title', selector: '', type: 'text' },
  ])
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<Result | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [discovering, setDiscovering] = React.useState<boolean>(false)
  const [discoverError, setDiscoverError] = React.useState<string | null>(null)
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
  const [suggestedListItemSelector, setSuggestedListItemSelector] = React.useState<string | null>(null)

  const bookingDemo = () => {
    setUrl('https://www.booking.com/searchresults.html?ss=Saudi+Arabia&ssne=Saudi+Arabia&ssne_untouched=Saudi+Arabia&label=gen173nr-10CAEoggI46AdIM1gEaBSIAQGYATO4ARfIAQzYAQPoAQH4AQGIAgGoAgG4AoDA1sUGwAIB0gIkOWY5ZTg1MmItODlkMi00NTYxLTg5MjUtNTIyMWRjYjg1NDRj2AIB4AIB&aid=304142&lang=en-us&sb=1&src_elem=sb&src=index&dest_id=186&dest_type=country&group_adults=2&no_rooms=1&group_children=0')
    setListItemSelector('div[data-testid="property-card"]')
    setFields([
      { name: 'name', selector: 'div[data-testid="title"]', type: 'text' },
      { name: 'link', selector: 'a[data-testid="title-link"]', type: 'attr', attr: 'href' },
      { name: 'price', selector: 'span[data-testid="price-and-discounted-price"]', type: 'text' },
      { name: 'rating', selector: 'div[data-testid="review-score"] div', type: 'text' },
    ])
  }

  const addField = () => setFields(prev => [...prev, { name: '', selector: '', type: 'text' }])
  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx))
  const updateField = (idx: number, patch: Partial<Field>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))

  const addFieldFromSuggestion = (s: Suggestion) => {
    // Avoid duplicates by name+selector
    const exists = fields.some(f => f.name === s.name && f.selector === s.selector && f.type === s.type && (f.attr || '') === (s.attr || ''))
    if (exists) return
    setFields(prev => [...prev, { name: s.name, selector: s.selector, type: s.type, attr: s.attr }])
  }

  const applySuggestedListSelector = () => {
    if (!suggestedListItemSelector) return
    setListItemSelector(suggestedListItemSelector)
  }

  

  const discover = async () => {
    if (!url) return
    setDiscovering(true)
    setDiscoverError(null)
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to discover')
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : [])
      setSuggestedListItemSelector(json.listItemSelector || null)
    } catch (e: any) {
      setDiscoverError(e?.message || 'Discovery failed')
      setSuggestions([])
      setSuggestedListItemSelector(null)
    } finally {
      setDiscovering(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      // Basic validation for simplified flow
      if (!url) throw new Error('URL is required')
      if (!fields.length) throw new Error('Add at least one field')
      if (!listItemSelector) throw new Error('List item selector is required')

      const payload = {
        url,
        mode: 'list' as const,
        listItemSelector,
        fields,
        limit: typeof limit === 'number' ? limit : undefined,
        offset: typeof offset === 'number' ? offset : undefined,
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
          <label className="md:col-span-3">
            <div className="mb-1 text-sm font-medium">URL</div>
            <div className="flex items-center gap-2">
              <input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200" />
              <button type="button" onClick={discover} disabled={!url || discovering} className="whitespace-nowrap rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
                {discovering ? 'Discovering…' : 'Auto Discover fetchable data'}
              </button>
            </div>
            {discoverError && <div className="mt-1 text-xs text-red-600">{discoverError}</div>}
          </label>
        </div>

        {(suggestions.length > 0 || suggestedListItemSelector) && (
          <div className="space-y-2 rounded border border-dashed p-3">
            {suggestedListItemSelector && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Suggested list item selector:</span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5">{suggestedListItemSelector}</code>
                <button type="button" onClick={applySuggestedListSelector} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">Apply</button>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Suggested fields</div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${s.name}-${s.selector}-${i}`}
                      type="button"
                      onClick={() => addFieldFromSuggestion(s)}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50"
                      title={`${s.selector}${s.type === 'attr' && s.attr ? ` [attr=${s.attr}]` : ''}`}
                    >
                      {s.name} <span className="text-gray-500">({s.selector}{s.type === 'attr' && s.attr ? ` @${s.attr}` : ''})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Explicit List Item Selector input */}
        <div>
          <label className="block">
            <div className="mb-1 text-sm font-medium">List item selector</div>
            <input
              required
              type="text"
              value={listItemSelector}
              onChange={e => setListItemSelector(e.target.value)}
              placeholder="e.g. div[data-testid='property-card'] or li.product"
              className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
            />
            <div className="mt-1 text-xs text-gray-500">CSS selector that matches each item in the list/grid.</div>
          </label>
        </div>

        {/* Simplified options: Item count and Offset only */}
        <div className="grid gap-3 md:grid-cols-3">
          <label>
            <div className="mb-1 text-sm font-medium">Item count (optional)</div>
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
              placeholder="e.g. 100"
              className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
            />
          </label>
          <label>
            <div className="mb-1 text-sm font-medium">Offset (optional)</div>
            <input
              type="number"
              min={0}
              value={offset}
              onChange={e => {
                const v = e.target.value
                if (v === '') return setOffset('')
                const num = Number(v)
                setOffset(Number.isFinite(num) && num >= 0 ? Math.floor(num) : '')
              }}
              placeholder="e.g. 15"
              className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
            />
          </label>
        </div>

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
