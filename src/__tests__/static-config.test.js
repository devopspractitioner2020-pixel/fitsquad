// Guards on the files in public/ that configure the CDN rather than the app.
//
// Nothing imports these, so nothing type-checks them and no component test
// touches them. They are read by Cloudflare at deploy time, which means a
// mistake here does not fail locally, does not fail the build, and surfaces
// as a failed deploy or — worse — as a silently broken security header on a
// site that looks fine.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

describe('_redirects', () => {
  // The deploy failure this file exists to prevent:
  //
  //   Invalid _redirects configuration:
  //   Line 1: Infinite loop detected in this rule. This would cause a
  //   redirect to strip `.html` or `/index` and end up triggering this rule
  //   again. [code: 100324]
  //
  // `/*  /index.html  200` is the standard SPA fallback on Cloudflare PAGES.
  // On WORKERS static assets it is rejected outright, because Workers already
  // normalises `/index.html` and the rule would rematch its own output. The
  // deploy uploads every asset successfully and then fails at the very last
  // API call, which makes it look like an outage rather than a config error.
  it('does not exist — Workers rejects the Pages-style SPA fallback', () => {
    expect(existsSync(resolve(root, 'public/_redirects'))).toBe(false)
  })

  it('has not come back with a catch-all rewrite if it ever returns', () => {
    if (!existsSync(resolve(root, 'public/_redirects'))) return
    expect(read('public/_redirects')).not.toMatch(/^\s*\/\*\s+\/index\.html\s+200/m)
  })
})

describe('wrangler.jsonc', () => {
  // This is what replaces _redirects. Deleting the file without this setting
  // would leave every deep link — /me, /plan, /saved/tips — 404ing on a hard
  // refresh, which is a far quieter failure than the deploy error above.
  it('handles SPA routing itself, since _redirects no longer can', () => {
    expect(read('wrangler.jsonc')).toMatch(/"not_found_handling":\s*"single-page-application"/)
  })

  it('points at the Vite build output', () => {
    expect(read('wrangler.jsonc')).toMatch(/"directory":\s*"\.\/dist\/?"/)
  })

  // Vite inlines VITE_* at build time. A Worker variable is set after the
  // build has finished, so putting them here does nothing except look like
  // it worked.
  it('carries no VITE_ variables, which would be read too late to matter', () => {
    const vars = read('wrangler.jsonc').replace(/\/\/.*$/gm, '')
    expect(vars).not.toMatch(/VITE_SUPABASE/)
  })
})

describe('_headers', () => {
  const headers = () => read('public/_headers')

  it('still exists — Workers honours it, and it carries the CSP', () => {
    expect(existsSync(resolve(root, 'public/_headers'))).toBe(true)
    expect(headers()).toMatch(/Content-Security-Policy:/)
  })

  // CSP frame blocks are near-silent: the embed goes blank and the console
  // says little. Every provider the feed can embed has to be listed here or
  // the feature is broken in production only.
  it('allows exactly the video hosts the feed embeds', () => {
    const csp = headers()
    for (const host of [
      'https://www.tiktok.com',
      'https://www.instagram.com',
      'https://www.youtube-nocookie.com',
    ]) {
      expect(csp).toContain(host)
    }
  })

  it('keeps the headers that stop the app being framed or sniffed', () => {
    const h = headers()
    expect(h).toMatch(/X-Content-Type-Options: nosniff/)
    expect(h).toMatch(/frame-ancestors 'none'/)
    expect(h).toMatch(/Strict-Transport-Security:/)
  })
})
