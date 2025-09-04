"use client"

import React from 'react'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

type PaginationInfo = {
  type: 'infinite_scroll' | 'traditional_pagination' | 'load_more_button' | 'none'
  nextButtonSelector?: string
  prevButtonSelector?: string
  pageNumberSelectors?: string[]
  loadMoreSelector?: string
  hasNumberedPages?: boolean
  totalPagesSelector?: string
  currentPageSelector?: string
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

type DiscoveryResult = {
  ok: boolean
  suggestions?: Suggestion[]
  listItemSelector?: string
  pagination?: PaginationInfo
  error?: string
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
  const [paginationInfo, setPaginationInfo] = React.useState<PaginationInfo | null>(null)
  const [paginationStrategy, setPaginationStrategy] = React.useState<'auto' | 'infinite_scroll' | 'traditional_pagination' | 'load_more_button' | 'none'>('auto')
  const [customNextSelector, setCustomNextSelector] = React.useState<string>('')
  const [customLoadMoreSelector, setCustomLoadMoreSelector] = React.useState<string>('')

  const bookingDemo = () => {
    setUrl('https://www.booking.com/searchresults.html?ss=Saudi+Arabia&ssne=Saudi+Arabia&ssne_untouched=Saudi+Arabia&label=gen173nr-10CAEoggI46AdIM1gEaBSIAQGYATO4ARfIAQzYAQPoAQH4AQGIAgGoAgG4AoDA1sUGwAIB0gIkOWY5ZTg1MmItODlkMi00NTYxLTg5MjUtNTIyMWRjYjg1NDRj2AIB4AIB&aid=304142&lang=en-us&sb=1&src_elem=sb&src=index&dest_id=186&dest_type=country&group_adults=2&no_rooms=1&group_children=0')
    setListItemSelector('div[data-testid="property-card"]')
    setFields([
      { name: 'name', selector: 'div[data-testid="title"], h3, h2, .property-title', type: 'text' },
      { name: 'link', selector: 'a[data-testid="title-link"], h3 a, h2 a, a', type: 'attr', attr: 'href' },
      { name: 'price', selector: 'span[data-testid="price-and-discounted-price"], .price, [class*="price"]', type: 'text' },
      { name: 'rating', selector: 'div[data-testid="review-score"] div, .review-score, [class*="rating"], [class*="score"]', type: 'text' },
    ])
    setPaginationStrategy('infinite_scroll')
  }

  const alibabaDemo = () => {
    setUrl('https://www.alibaba.com/search/page?spm=a2700.product_home_fy25.home_login_first_screen_fy23_pc_search_bar.keydown__Enter&SearchScene=proSearch&SearchText=mobile&pro=true&from=pcHomeContent')
    setListItemSelector('.organic-offer-wrapper, .product-item, [class*="product-card"], .search-card-container, .card-info')
    setFields([
      { name: 'title', selector: '.product-title, .title, h2, h3, [class*="title"], [class*="subject"]', type: 'text' },
      { name: 'price', selector: '.price, .product-price, [class*="price"], .offer-price', type: 'text' },
      { name: 'supplier', selector: '.supplier, .company-name, [class*="supplier"], [class*="company"]', type: 'text' },
      { name: 'image', selector: 'img', type: 'attr', attr: 'src' },
      { name: 'link', selector: 'a', type: 'attr', attr: 'href' },
    ])
    setPaginationStrategy('traditional_pagination')
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
      const json: DiscoveryResult = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to discover')
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : [])
      setSuggestedListItemSelector(json.listItemSelector || null)
      setPaginationInfo(json.pagination || null)
      
      // Auto-set pagination strategy based on discovery
      if (json.pagination) {
        setPaginationStrategy(json.pagination.type === 'none' ? 'infinite_scroll' : json.pagination.type)
        if (json.pagination.nextButtonSelector) {
          setCustomNextSelector(json.pagination.nextButtonSelector)
        }
        if (json.pagination.loadMoreSelector) {
          setCustomLoadMoreSelector(json.pagination.loadMoreSelector)
        }
      }
    } catch (e: any) {
      setDiscoverError(e?.message || 'Discovery failed')
      setSuggestions([])
      setSuggestedListItemSelector(null)
      setPaginationInfo(null)
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
        paginationStrategy,
        nextButtonSelector: customNextSelector || paginationInfo?.nextButtonSelector,
        loadMoreSelector: customLoadMoreSelector || paginationInfo?.loadMoreSelector,
        pageNumberSelectors: paginationInfo?.pageNumberSelectors,
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
        <button type="button" onClick={alibabaDemo} className="rounded bg-orange-600 px-3 py-1.5 text-white hover:bg-orange-700">Load Alibaba.com demo</button>
        <span className="text-sm text-gray-500">Quick setup for common e-commerce sites</span>
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

        {(suggestions.length > 0 || suggestedListItemSelector || paginationInfo) && (
          <div className="space-y-3 rounded border border-dashed p-4">
            <div className="text-sm font-medium text-gray-700">🔍 Auto-Discovery Results</div>
            
            {suggestedListItemSelector && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">List item selector:</span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5">{suggestedListItemSelector}</code>
                <button type="button" onClick={applySuggestedListSelector} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">Apply</button>
              </div>
            )}
            
            {paginationInfo && paginationInfo.type !== 'none' && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700">📄 Pagination Detected</div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Type:</span>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">
                      {paginationInfo.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  {paginationInfo.nextButtonSelector && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Next button:</span>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5">{paginationInfo.nextButtonSelector}</code>
                    </div>
                  )}
                  {paginationInfo.loadMoreSelector && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Load more:</span>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5">{paginationInfo.loadMoreSelector}</code>
                    </div>
                  )}
                  {paginationInfo.hasNumberedPages && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Page numbers:</span>
                      <span className="text-green-600">✓ Detected</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {suggestions.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-gray-700">🏷️ Suggested fields</div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${s.name}-${s.selector}-${i}`}
                      type="button"
                      onClick={() => addFieldFromSuggestion(s)}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50"
                      title={`${s.selector}${s.type === 'attr' && s.attr ? ` [attr=${s.attr}]` : ''} (confidence: ${s.confidence})`}
                    >
                      {s.name} <span className="text-gray-500">({s.selector}{s.type === 'attr' && s.attr ? ` @${s.attr}` : ''})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pagination Strategy Selection */}
        <div className="space-y-3">
          <div className="text-sm font-medium">📄 Pagination Strategy</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <div className="mb-1 text-sm font-medium">Strategy</div>
              <select 
                value={paginationStrategy} 
                onChange={e => setPaginationStrategy(e.target.value as any)}
                className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
              >
                <option value="auto">🔍 Auto-detect</option>
                <option value="infinite_scroll">📜 Infinite Scroll</option>
                <option value="traditional_pagination">📄 Traditional Pagination</option>
                <option value="load_more_button">🔘 Load More Button</option>
                <option value="none">🚫 No Pagination</option>
              </select>
            </label>
          </div>
          
          {(paginationStrategy === 'traditional_pagination' || paginationStrategy === 'auto') && (
            <label>
              <div className="mb-1 text-sm font-medium">Custom Next Button Selector (optional)</div>
              <input
                type="text"
                value={customNextSelector}
                onChange={e => setCustomNextSelector(e.target.value)}
                placeholder="e.g. a[rel='next'], .pagination-next"
                className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
              />
              <div className="mt-1 text-xs text-gray-500">Override auto-detected next button selector</div>
            </label>
          )}
          
          {(paginationStrategy === 'load_more_button' || paginationStrategy === 'auto') && (
            <label>
              <div className="mb-1 text-sm font-medium">Custom Load More Selector (optional)</div>
              <input
                type="text"
                value={customLoadMoreSelector}
                onChange={e => setCustomLoadMoreSelector(e.target.value)}
                placeholder="e.g. button.load-more, .show-more-btn"
                className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
              />
              <div className="mt-1 text-xs text-gray-500">Override auto-detected load more button selector</div>
            </label>
          )}
        </div>

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
            <div className="mt-1 text-xs text-gray-500">Total number of items to scrape across all pages</div>
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
            <div className="mt-1 text-xs text-gray-500">Number of items to skip before collecting data</div>
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
          {paginationStrategy !== 'none' && (
            <div className="text-xs text-gray-500">
              🔄 Will navigate through pages using {paginationStrategy.replace('_', ' ')} strategy
            </div>
          )}
          <div className="text-xs text-gray-500">
            🔍 Check browser console for detailed logs
          </div>
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
