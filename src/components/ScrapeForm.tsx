"use client"

import React from 'react'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

type ExclusionFilter = {
  fieldName: string
  existingItems: Record<string, any>[]
  matchType: 'exact' | 'contains' | 'startsWith' | 'endsWith'
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
  const [exclusionFilter, setExclusionFilter] = React.useState<ExclusionFilter>({
    fieldName: '',
    existingItems: [],
    matchType: 'exact'
  })
  const [exclusionInput, setExclusionInput] = React.useState<string>('')

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
    // Clear exclusion filter
    setExclusionFilter({ fieldName: '', existingItems: [], matchType: 'exact' })
    setExclusionInput('')
  }

  const alibabaDemo = () => {
    setUrl('https://www.alibaba.com/search/page?spm=a2700.product_home_fy25.home_login_first_screen_fy23_pc_search_bar.keydown__Enter&SearchScene=proSearch&SearchText=mobile&pro=true&from=pcHomeContent')
    setListItemSelector('.organic-offer-wrapper')
    setFields([
      { name: 'title', selector: '.product-title, .title, h2, h3, [class*="title"], [class*="subject"]', type: 'text' },
      { name: 'price', selector: '.price, .product-price, [class*="price"], .offer-price', type: 'text' },
      { name: 'supplier', selector: '.supplier, .company-name, [class*="supplier"], [class*="company"]', type: 'text' },
      { name: 'image', selector: 'img', type: 'attr', attr: 'src' },
      { name: 'link', selector: 'a', type: 'attr', attr: 'href' },
    ])
    setPaginationStrategy('traditional_pagination')
    // Clear exclusion filter
    setExclusionFilter({ fieldName: '', existingItems: [], matchType: 'exact' })
    setExclusionInput('')
    // Set example exclusion filter for demo
    const sampleExistingItems = [
      {
        "_index": 0,
        "title": "2025 New Low Price I16 Pro Max Mobile Phones 5g Dual Sim Global Version Smartphone 10 Core 16gb+1tb Large Screen Cell Phones",
        "price": "$86$17250% offMin. order: 1 piece18 sold",
        "supplier": "Chenghai (shenzhen) Foreign Trade Technology Co., Ltd.,1 yrCN3.8/5.0 (8)"
      },
      {
        "_index": 1, 
        "title": "Sample Mobile Phone to Exclude",
        "price": "$100",
        "supplier": "Sample Supplier"
      }
    ]
    setExclusionFilter({ fieldName: 'title', existingItems: sampleExistingItems, matchType: 'contains' })
    setExclusionInput(JSON.stringify(sampleExistingItems, null, 2))
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

  // Handle exclusion filter
  const updateExclusionItems = (input: string) => {
    setExclusionInput(input)
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) {
        // Validate that all items are objects
        const validItems = parsed.filter(item => 
          typeof item === 'object' && 
          item !== null && 
          !Array.isArray(item)
        )
        setExclusionFilter(prev => ({ ...prev, existingItems: validItems }))
      } else {
        // Single object case
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          setExclusionFilter(prev => ({ ...prev, existingItems: [parsed] }))
        }
      }
    } catch {
      // Invalid JSON - clear the filter
      setExclusionFilter(prev => ({ ...prev, existingItems: [] }))
    }
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
        exclusionFilter: exclusionFilter.fieldName && exclusionFilter.existingItems.length > 0 ? exclusionFilter : undefined,
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

  // Download functions
  const downloadJSON = () => {
    if (!result?.data) return
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scraped-data-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadCSV = () => {
    if (!result?.data || !Array.isArray(result.data)) return
    
    const headers = Object.keys(result.data[0] || {})
    const csvContent = [
      headers.join(','),
      ...result.data.map(row => 
        headers.map(header => {
          const value = row[header] ?? ''
          // Escape quotes and wrap in quotes if contains comma or quote
          const escaped = String(value).replace(/"/g, '""')
          return /[,"\n\r]/.test(escaped) ? `"${escaped}"` : escaped
        }).join(',')
      )
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scraped-data-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadXLSX = async () => {
    if (!result?.data || !Array.isArray(result.data)) return
    
    try {
      const XLSX = await import('xlsx')
      const worksheet = XLSX.utils.json_to_sheet(result.data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data')
      XLSX.writeFile(workbook, `scraped-data-${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (error) {
      console.error('Error downloading XLSX:', error)
      alert('Error downloading XLSX file. Please try JSON or CSV instead.')
    }
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

        {/* Exclusion Filter Section */}
        <div className="space-y-3">
          <div className="text-sm font-medium">🚫 Exclusion Filter (Optional)</div>
          <div className="rounded border border-gray-200 p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <div className="mb-1 text-sm font-medium">Field to Match</div>
                <select 
                  value={exclusionFilter.fieldName} 
                  onChange={e => setExclusionFilter(prev => ({ ...prev, fieldName: e.target.value }))}
                  className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
                >
                  <option value="">Select field...</option>
                  {fields.map(field => (
                    <option key={field.name} value={field.name}>{field.name}</option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-gray-500">Field to check for exclusion matches</div>
              </label>
              
              <label>
                <div className="mb-1 text-sm font-medium">Match Type</div>
                <select 
                  value={exclusionFilter.matchType} 
                  onChange={e => setExclusionFilter(prev => ({ ...prev, matchType: e.target.value as any }))}
                  className="w-full rounded border px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
                >
                  <option value="exact">Exact Match</option>
                  <option value="contains">Contains</option>
                  <option value="startsWith">Starts With</option>
                  <option value="endsWith">Ends With</option>
                </select>
              </label>
            </div>
            
            <label>
              <div className="mb-1 text-sm font-medium">Existing Items JSON</div>
              <textarea
                value={exclusionInput}
                onChange={e => updateExclusionItems(e.target.value)}
                placeholder='[{"_index": 0, "title": "Mobile Phone 1", "price": "$100"}, {"_index": 1, "title": "Mobile Phone 2", "price": "$200"}]'
                rows={6}
                className="w-full rounded border px-3 py-2 font-mono text-sm focus:outline-none focus:ring focus:ring-indigo-200"
              />
              <div className="mt-1 text-xs text-gray-500">
                Paste your existing scraped items as JSON array. The scraper will exclude new items that match existing ones.
                {exclusionFilter.existingItems.length > 0 && (
                  <div className="mt-1 text-green-600">
                    ✓ {exclusionFilter.existingItems.length} existing item(s) loaded for comparison
                  </div>
                )}
                {exclusionInput && exclusionFilter.existingItems.length === 0 && (
                  <div className="mt-1 text-red-600">
                    ✗ Invalid JSON format. Please check your syntax.
                  </div>
                )}
              </div>
            </label>
            
            {exclusionFilter.fieldName && exclusionFilter.existingItems.length > 0 && (
              <div className="text-xs text-blue-600 bg-blue-50 p-3 rounded">
                📝 <strong>Exclusion Preview:</strong><br/>
                Field: <strong>{exclusionFilter.fieldName}</strong><br/>
                Match Type: <strong>{exclusionFilter.matchType}</strong><br/>
                Existing Items: <strong>{exclusionFilter.existingItems.length}</strong><br/>
                <div className="mt-2">
                  Sample values to exclude:
                  <ul className="mt-1 ml-4 list-disc">
                    {exclusionFilter.existingItems.slice(0, 3).map((item, idx) => (
                      <li key={idx} className="truncate">
                        <code>"{item[exclusionFilter.fieldName] || 'N/A'}"</code>
                      </li>
                    ))}
                    {exclusionFilter.existingItems.length > 3 && (
                      <li>... and {exclusionFilter.existingItems.length - 3} more</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
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
            🔍 Check browser console for detailed logs (including deduplication info)
          </div>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      {result && (
        <div className="space-y-2 rounded border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              Result {result.mode === 'list' && typeof result.count === 'number' ? `(${result.count} items)` : ''}
              {exclusionFilter.fieldName && exclusionFilter.existingItems.length > 0 && (
                <span className="ml-2 text-xs text-blue-600">
                  🚫 Filtered against {exclusionFilter.existingItems.length} existing items
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={copyResult} className="rounded border px-2 py-1 text-sm hover:bg-gray-50" title="Copy JSON to clipboard">
                📋 Copy JSON
              </button>
              <div className="flex items-center gap-1">
                <button onClick={downloadJSON} className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700" title="Download as JSON">
                  📄 JSON
                </button>
                <button onClick={downloadCSV} className="rounded bg-green-600 px-2 py-1 text-sm text-white hover:bg-green-700" title="Download as CSV">
                  📈 CSV
                </button>
                <button onClick={downloadXLSX} className="rounded bg-orange-600 px-2 py-1 text-sm text-white hover:bg-orange-700" title="Download as Excel">
                  📉 XLSX
                </button>
              </div>
            </div>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
