import { NextResponse } from 'next/server'
import * as puppeteer from 'puppeteer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Mode = 'single' | 'list'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
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
}

export async function POST(req: Request) {
  let browser: puppeteer.Browser | null = null
  try {
    const body = (await req.json()) as Body
    const { url, mode, listItemSelector, fields, waitForSelector, timeoutMs, limit, deepSearch, detailUrlFieldName } = body

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

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    } catch (e) {
      // Retry once if the first navigation fails
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    }

    // Attempt to accept cookie consent if present (Booking.com typically uses OneTrust)
    try {
      const consentBtn = await page.$('#onetrust-accept-btn-handler')
      if (consentBtn) {
        await consentBtn.click()
        await new Promise(resolve => setTimeout(resolve, 800))
      }
    } catch {}

    const effectiveWaitFor = waitForSelector ?? (mode === 'list' ? listItemSelector! : undefined)
    if (effectiveWaitFor) {
      await page.waitForSelector(effectiveWaitFor, { visible: true })
    }

    if (mode === 'list') {
      await page.waitForSelector(listItemSelector!, { visible: true })
      // Gentle auto-scroll to load more items in case of lazy loading
      try {
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let total = 0
            const distance = 600
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight
              window.scrollBy(0, distance)
              total += distance
              if (total >= scrollHeight * 0.8) {
                clearInterval(timer)
                resolve()
              }
            }, 150)
          })
        })
        await new Promise(resolve => setTimeout(resolve, 800))
      } catch {}
      const data = await page.$$eval(
        listItemSelector!,
        (items, fields, limit) => {
          const elements = Array.from(items as Element[]).slice(0, typeof limit === 'number' ? limit : (items as Element[]).length)
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
        (typeof limit === 'number' && isFinite(limit) && limit > 0) ? Math.floor(limit) : undefined,
      )

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
