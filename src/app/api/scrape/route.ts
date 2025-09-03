import { NextResponse } from 'next/server'
import * as puppeteer from 'puppeteer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Mode = 'single' | 'list'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

// Stealth: reduce obvious automation signals
async function applyStealth(page: puppeteer.Page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    // @ts-ignore
    window.chrome = { runtime: {} }
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
    const originalQuery = (window.navigator.permissions && window.navigator.permissions.query) as any
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : originalQuery(parameters)
      )
    }
    const getParameter = (WebGLRenderingContext as any).prototype.getParameter
    ;(WebGLRenderingContext as any).prototype.getParameter = function (parameter: any) {
      if (parameter === 37445) return 'Intel Inc.' // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine' // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter)
    }
    const originalPlugins = (navigator as any).plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }],
    })
  })
}

// Try to accept cookie banners heuristically
async function acceptCookiesIfPresent(page: puppeteer.Page) {
  try {
    const selectors = [
      'button#onetrust-accept-btn-handler',
      "button[aria-label='Accept']",
      "button[data-testid='accept-cookies-button']",
      "button[aria-label='Accept all']",
      "button[aria-label='I agree']",
    ]
    for (const sel of selectors) {
      const btn = await page.$(sel)
      if (btn) { await btn.click().catch(() => {}); await new Promise(r => setTimeout(r, 500)); return }
    }
    // Fallback: scan visible buttons/links for accept-like text
    const clicked = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, a[role="button"], a')) as HTMLElement[]
      const phrases = ['accept', 'i agree', 'got it', 'agree & close']
      for (const el of nodes) {
        const txt = (el.innerText || el.textContent || '').toLowerCase().trim()
        if (!txt || !phrases.some(p => txt.includes(p))) continue
        const rect = el.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) { el.click(); return true }
      }
      return false
    })
    if (clicked) { await new Promise(r => setTimeout(r, 500)) }
  } catch {}
}

type Body = {
  url: string
  mode: Mode
  listItemSelector?: string
  fields: Field[]
  waitForSelector?: string
  timeoutMs?: number
  limit?: number
  deepSearch?: boolean
  detailUrlFieldName?: string
  min?: number
  pages?: number
  offset?: number
  nextButtonSelector?: string
  prevButtonSelector?: string
}

export async function POST(req: Request) {
  let browser: puppeteer.Browser | null = null
  try {
    const body = (await req.json()) as Body
    const { url, mode, listItemSelector, fields, waitForSelector, timeoutMs, limit, deepSearch, detailUrlFieldName, min, pages, offset, nextButtonSelector, prevButtonSelector } = body

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'Valid url is required' }, { status: 400 })
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return NextResponse.json({ ok: false, error: 'At least one field is required' }, { status: 400 })
    }
    if (mode === 'list' && !listItemSelector) {
      return NextResponse.json({ ok: false, error: 'listItemSelector is required for list mode' }, { status: 400 })
    }
    if (mode === 'list' && deepSearch && !detailUrlFieldName) {
      return NextResponse.json({ ok: false, error: 'detailUrlFieldName is required when deepSearch is enabled' }, { status: 400 })
    }
    if (mode === 'list' && typeof min === 'number' && typeof limit === 'number' && min > limit) {
      return NextResponse.json({ ok: false, error: 'min cannot be greater than max (limit)' }, { status: 400 })
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US,en',
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1366, height: 1000 })
    const navTimeout = Math.min(Math.max(timeoutMs ?? 60000, 10000), 120000)
    page.setDefaultNavigationTimeout(navTimeout)
    page.setDefaultTimeout(navTimeout)
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // Stealth as early as possible
    await applyStealth(page)

    try {
      await page.goto(url, { waitUntil: 'networkidle2' })
    } catch (e) {
      // Retry once if the first navigation fails
      await page.goto(url, { waitUntil: 'networkidle2' })
    }

    // Attempt to accept cookie consent if present (Booking.com typically uses OneTrust)
    await acceptCookiesIfPresent(page)

    const effectiveWaitFor = waitForSelector ?? (mode === 'list' ? listItemSelector! : undefined)
    if (effectiveWaitFor) {
      await page.waitForSelector(effectiveWaitFor, { visible: true })
    }

    if (mode === 'list') {
      const maxPages = (typeof pages === 'number' && isFinite(pages) && pages > 0) ? Math.floor(pages) : Number.POSITIVE_INFINITY
      const maxItems = (typeof limit === 'number' && isFinite(limit) && limit > 0) ? Math.floor(limit) : undefined
      const minItems = (typeof min === 'number' && isFinite(min) && min > 0) ? Math.floor(min) : undefined
      let skipRemaining = (typeof offset === 'number' && isFinite(offset) && offset > 0) ? Math.floor(offset) : 0

      const aggregate: Record<string, any>[] = []
      let currentPage = 1
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

      const scrapeCurrentPage = async (): Promise<Record<string, any>[]> => {
        await page.waitForSelector(listItemSelector!, { visible: true })
        // Load more until we reach target count (offset + limit) or stagnate
        try {
          const getCount = async () => {
            try { return await page.$$eval(listItemSelector!, els => els.length) } catch { return 0 }
          }
          const remainingNeed = typeof maxItems === 'number' ? Math.max(maxItems - aggregate.length, 0) : undefined
          const desiredOnPageCount = typeof remainingNeed === 'number' ? (remainingNeed + skipRemaining) : undefined

          let count = await getCount()
          let stagnationRounds = 0

          const autoScrollToBottom = async () => {
            try {
              await page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                  let total = 0
                  const distance = 600
                  const timer = setInterval(() => {
                    const { scrollHeight } = document.body
                    window.scrollBy(0, distance)
                    total += distance
                    if (total >= scrollHeight - window.innerHeight - 200) {
                      clearInterval(timer)
                      resolve()
                    }
                  }, 120)
                })
              })
            } catch {}
          }

          const clickLoadMoreIfAvailable = async (): Promise<boolean> => {
            try {
              return await page.evaluate(() => {
                const candidates = Array.from(document.querySelectorAll('button, a[role="button"], a')) as HTMLElement[]
                const phrases = ['load more', 'see more', 'show more', 'more results', 'more properties']
                for (const el of candidates) {
                  const txt = (el.innerText || el.textContent || '').toLowerCase().trim()
                  if (!txt || !phrases.some(p => txt.includes(p))) continue
                  const rect = el.getBoundingClientRect()
                  const visible = rect && rect.width > 0 && rect.height > 0
                  if (!visible) continue
                  el.scrollIntoView({ behavior: 'auto', block: 'center' })
                  el.click()
                  return true
                }
                return false
              })
            } catch { return false }
          }

          const waitForNewResults = async (prevCount: number, timeoutMs = 10000) => {
            const start = Date.now()
            let latest = prevCount
            while (Date.now() - start < timeoutMs) {
              const c = await getCount()
              if (c > prevCount) return c
              latest = c
              await sleep(400)
            }
            return latest
          }

          while (typeof desiredOnPageCount === 'number' && count < desiredOnPageCount) {
            const before = count
            await autoScrollToBottom()
            const clicked = await clickLoadMoreIfAvailable()
            if (clicked) await sleep(1500)
            count = await waitForNewResults(before, 10000)

            if (count <= before) {
              stagnationRounds += 1
              // Nudge scroll to trigger lazy-loaders
              try { await page.evaluate(() => window.scrollBy(0, -400)) } catch {}
              await sleep(600)
              try { await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)) } catch {}
              await sleep(1000)
              const maybe = await getCount()
              if (maybe > count) {
                count = maybe
                stagnationRounds = 0
              }
            } else {
              stagnationRounds = 0
            }

            if (stagnationRounds >= 5) break
          }

          await sleep(300)
        } catch {}

        const pageData = await page.$$eval(
          listItemSelector!,
          (items, fields) => {
            const elements = Array.from(items as Element[])
            return elements.map((item) => {
              const obj: Record<string, any> = {}
              for (const f of fields as any[]) {
                let value: any = null
                const target = f.selector ? item.querySelector(f.selector) : item
                if (target) {
                  if (f.type === 'text') {
                    value = target.textContent?.trim() ?? null
                  } else if (f.type === 'attr' && f.attr) {
                    value = target.getAttribute(f.attr)
                  }
                }
                obj[f.name] = value
              }
              return obj
            })
          },
          fields,
        )

        // Apply global offset skipping across pages
        let processed = pageData
        if (skipRemaining > 0) {
          if (processed.length <= skipRemaining) {
            skipRemaining -= processed.length
            processed = []
          } else {
            processed = processed.slice(skipRemaining)
            skipRemaining = 0
          }
        }

        // Apply cap for remaining needed items (respect min/max)
        const needed = (() => {
          const maxNeed = typeof maxItems === 'number' ? Math.max(maxItems - aggregate.length, 0) : Infinity
          const minNeed = typeof minItems === 'number' ? Math.max(minItems - aggregate.length, 0) : 0
          // If max is set, cap by max; else if only min is set, allow more than min but we target at least min
          return Math.min(maxNeed, Infinity) === Infinity ? (minNeed > 0 ? processed.length : processed.length) : Math.min(maxNeed, processed.length)
        })()
        if (typeof maxItems === 'number') {
          processed = processed.slice(0, needed)
        }
        return processed
      }

      const getListSnapshot = async () => {
        try {
          const snapshot = await page.evaluate((sel) => {
            const items = Array.from(document.querySelectorAll(sel))
            const firstText = (items[0]?.textContent || '').slice(0, 80)
            return { href: location.href, count: items.length, firstText }
          }, listItemSelector!)
          return snapshot as { href: string; count: number; firstText: string }
        } catch {
          return { href: '', count: 0, firstText: '' }
        }
      }

      const gotoNextPage = async (): Promise<boolean> => {
        try {
          const before = await getListSnapshot()

          // Prefer custom selector if provided
          if (nextButtonSelector && nextButtonSelector.trim()) {
            const acted = await page.evaluate((sel) => {
              const el = document.querySelector(sel) as any
              if (!el) return { type: 'none' }
              if ((el instanceof HTMLAnchorElement || el instanceof HTMLLinkElement) && el.href) {
                return { type: 'href', href: el.href as string }
              }
              ;(el as HTMLElement).click()
              return { type: 'click' }
            }, nextButtonSelector)

            if ((acted as any).type === 'href') {
              const href = (acted as any).href as string
              try { await page.goto(href, { waitUntil: 'networkidle2' }) } catch { try { await page.goto(href, { waitUntil: 'networkidle2' }) } catch {} }
              return true
            }
            if ((acted as any).type === 'click') {
              // Wait for either navigation or list content change (supports load-more)
              try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }) } catch {}
              // Wait for list change
              const started = Date.now()
              while (Date.now() - started < 6000) {
                const after = await getListSnapshot()
                if (after.href !== before.href || after.count !== before.count || after.firstText !== before.firstText) {
                  return true
                }
                await new Promise(r => setTimeout(r, 300))
              }
              // If no visible change, still try fallback
            }
          }

          // Fallbacks: Try rel=next and common patterns
          const nextHref = await page.evaluate(() => {
            const relNext = document.querySelector('a[rel="next"]') as HTMLAnchorElement | null
            if (relNext?.href) return relNext.href
            const ariaNext = document.querySelector('a[aria-label*="Next" i]') as HTMLAnchorElement | null
            if (ariaNext?.href) return ariaNext.href
            const linkRelNext = document.querySelector('link[rel="next"]') as HTMLLinkElement | null
            if (linkRelNext?.href) return linkRelNext.href
            // Fallback: find an anchor with text containing Next
            const anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
            const a = anchors.find(a => /\b(next|more)\b/i.test(a.textContent || '') && a.href)
            return a?.href || null
          })
          if (nextHref) {
            try {
              await page.goto(nextHref as string, { waitUntil: 'networkidle2' })
              return true
            } catch {
              try { await page.goto(nextHref as string, { waitUntil: 'networkidle2' }) } catch { return false }
            }
          }

          // Try clickable next/load-more button by aria-label or text
          const clicked = await page.evaluate(() => {
            const byAria = document.querySelector('button[aria-label*="Next" i], button[aria-label*="More" i]') as HTMLButtonElement | null
            if (byAria) { byAria.click(); return true }
            const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
            const btn = buttons.find(b => /\b(next|more|load more|show more)\b/i.test(b.textContent || ''))
            if (btn) { btn.click(); return true }
            return false
          })
          if (clicked) {
            // Wait for list content to change
            const started = Date.now()
            while (Date.now() - started < 6000) {
              const after = await getListSnapshot()
              if (after.count !== before.count || after.firstText !== before.firstText) return true
              await new Promise(r => setTimeout(r, 300))
            }
          }
          return false
        } catch {
          return false
        }
      }

      // Scrape pages until we satisfy constraints or pages exhausted
      while (true) {
        const batch = await scrapeCurrentPage()
        aggregate.push(...batch)

        // Stop if reached max items
        if (typeof maxItems === 'number' && aggregate.length >= maxItems) break

        // If only a min is provided (no max), stop as soon as we reach min
        if (typeof maxItems !== 'number' && typeof minItems === 'number' && aggregate.length >= minItems) break

        if (currentPage >= maxPages) break
        currentPage += 1
        const moved = await gotoNextPage()
        if (!moved) break
        // Optional wait for either custom waitForSelector or listItemSelector on new page
        const waitSel = waitForSelector ?? listItemSelector!
        try { await page.waitForSelector(waitSel, { visible: true }) } catch {}
      }

      const data = typeof maxItems === 'number' ? aggregate.slice(0, maxItems) : aggregate

      // If deepSearch is enabled, iterate each item URL and merge detail page data
      if (deepSearch && detailUrlFieldName) {
        for (let i = 0; i < data.length; i++) {
          try {
            const linkRaw = data[i]?.[detailUrlFieldName]
            if (!linkRaw || typeof linkRaw !== 'string') continue
            let targetHref: string
            try {
              targetHref = new URL(linkRaw, url).href
            } catch {
              continue
            }

            try {
              await page.goto(targetHref, { waitUntil: 'domcontentloaded' })
            } catch {
              // retry once
              try { await page.goto(targetHref, { waitUntil: 'domcontentloaded' }) } catch { continue }
            }

            const detailWaitFor = waitForSelector
            if (detailWaitFor) {
              try { await page.waitForSelector(detailWaitFor, { visible: true }) } catch {}
            }

            // Extract the same fields again on the detail page and merge
            const detailResult: Record<string, any> = {}
            for (const f of fields) {
              try {
                if (f.type === 'text') {
                  const text = await page.$eval(f.selector, (el) => el.textContent?.trim() ?? null)
                  detailResult[f.name] = text ?? null
                } else if (f.type === 'attr' && f.attr) {
                  const attrVal = await page.$eval(
                    f.selector,
                    (el, attr) => el.getAttribute(attr as string),
                    f.attr,
                  )
                  detailResult[f.name] = attrVal ?? null
                } else {
                  detailResult[f.name] = null
                }
              } catch {
                detailResult[f.name] = data[i]?.[f.name] ?? null
              }
            }
            data[i] = { ...data[i], ...detailResult, _detailUrl: targetHref }
          } catch (e) {
            // swallow per-item errors to keep other results
          }
        }
      }

      return NextResponse.json({ ok: true, mode, count: data.length, data })
    }

    // Single mode
    const result: Record<string, any> = {}
    for (const f of fields) {
      try {
        if (f.type === 'text') {
          const text = await page.$eval(f.selector, (el) => el.textContent?.trim() ?? null)
          result[f.name] = text ?? null
        } else if (f.type === 'attr' && f.attr) {
          const attrVal = await page.$eval(
            f.selector,
            (el, attr) => el.getAttribute(attr as string),
            f.attr,
          )
          result[f.name] = attrVal ?? null
        } else {
          result[f.name] = null
        }
      } catch (e) {
        result[f.name] = null
      }
    }

    return NextResponse.json({ ok: true, mode, data: result })
  } catch (err: any) {
    console.error('Scrape error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
