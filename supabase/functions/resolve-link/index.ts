// Supabase Edge Function: resolve-link
//
// TikTok short links (vm.tiktok.com/XXXX) hide the real video ID behind a
// redirect the browser cannot follow due to CORS. This follows it
// server-side and returns the canonical URL. It does NOT download video, and
// it holds no secrets.
//
// SHORT LINKS ARE THE NORMAL CASE, not the exception: tapping Share → Copy
// link in the TikTok app gives you `vm.tiktok.com/…`, never the full URL. So
// this has to work reliably, and it tries four ways before giving up:
//
//   1. HEAD, following redirects.
//   2. GET, following redirects — some anti-bot layers answer HEAD with a
//      403 while serving GET perfectly happily.
//   3. GET with manual redirect following, reading Location headers one hop
//      at a time. Catches the case where the platform returns a 30x that the
//      runtime's auto-follow declines for its own reasons.
//   4. TikTok's public oEmbed endpoint, which accepts a short link directly
//      and returns the canonical URL as data. No key, no auth. This is the
//      most robust of the four because it is a documented API rather than a
//      redirect being observed from the outside.
//
// Requests carry a real mobile Safari user-agent. A string like
// "FitSquad/1.0" reads as a bot to TikTok's edge, and these calls come from
// datacenter IPs which are already treated with more suspicion than phones.
//
// Deploy with: supabase functions deploy resolve-link

const CORS_BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

// Only follow links on hosts we actually support. Without this the function
// is an open redirect resolver and an SSRF probe: anyone could point it at
// an internal address and learn where it lands. Keep the list closed.
const ALLOWED_HOSTS = new Set([
  'vm.tiktok.com',
  'vt.tiktok.com',
  'www.tiktok.com',
  'tiktok.com',
  'm.tiktok.com',
  'instagram.com',
  'www.instagram.com',
  'youtu.be',
  'www.youtube.com',
  'youtube.com',
])

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const FETCH_HEADERS = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
}

const TIMEOUT_MS = 8000
const MAX_HOPS = 6

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
  return { ...CORS_BASE, 'Access-Control-Allow-Origin': allow }
}

const isAllowed = (u: URL) => ALLOWED_HOSTS.has(u.hostname.toLowerCase())

/** Is this already a link we can embed without resolving anything? */
function isCanonical(u: URL): boolean {
  return /\/@[\w.-]+\/video\/\d+/i.test(u.pathname)
    || /^\/(?:reel|reels|p|tv)\//i.test(u.pathname)
    || /^\/shorts\//i.test(u.pathname)
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctl.signal, headers: FETCH_HEADERS })
  } finally {
    clearTimeout(timer)
  }
}

/** Attempts 1 and 2: let the runtime follow the chain. */
async function followAuto(url: string, method: 'HEAD' | 'GET'): Promise<URL | null> {
  try {
    const res = await timedFetch(url, { method, redirect: 'follow' })
    const final = new URL(res.url)
    if (final.href === url) return null // never moved
    return isAllowed(final) ? final : null
  } catch {
    return null
  }
}

/** Attempt 3: walk Location headers ourselves. */
async function followManual(url: string): Promise<URL | null> {
  let current = url
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response
    try {
      res = await timedFetch(current, { method: 'GET', redirect: 'manual' })
    } catch {
      return null
    }
    const location = res.headers.get('location')
    if (!location) {
      const here = new URL(current)
      return isCanonical(here) && isAllowed(here) ? here : null
    }
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      return null
    }
    // Re-check every hop, not just the first. A shortener that forwards
    // off-platform must not be laundered into a stored link.
    if (!isAllowed(next)) return null
    if (isCanonical(next)) return next
    current = next.href
  }
  return null
}

/**
 * Attempt 4: TikTok's public oEmbed endpoint.
 *
 * It takes a short link directly and answers with JSON, so there is no
 * redirect chain to observe and no anti-bot page to trip over. The canonical
 * URL comes back inside the embed HTML's `cite` attribute, with the video id
 * also available as `embed_product_id`.
 */
async function viaOembed(url: string): Promise<URL | null> {
  try {
    const res = await timedFetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      { method: 'GET' },
    )
    if (!res.ok) return null
    const data = await res.json()

    const cite = String(data?.html ?? '').match(/cite="([^"]+)"/)?.[1]
    if (cite) {
      const u = new URL(cite)
      if (isAllowed(u) && isCanonical(u)) return u
    }

    const id = data?.embed_product_id
    const author = String(data?.author_unique_id ?? data?.author_url ?? '')
      .replace(/^.*@/, '').trim()
    if (id && author) {
      return new URL(`https://www.tiktok.com/@${author}/video/${id}`)
    }
    return null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const body = await req.json().catch(() => null)
    const url = body?.url
    if (!url || typeof url !== 'string' || url.length > 2000) {
      return json({ error: 'No URL provided.', reason: 'bad-input' }, 400)
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return json({ error: 'That is not a valid URL.', reason: 'bad-input' }, 400)
    }
    if (parsed.protocol !== 'https:') {
      return json({ error: 'Only https links are supported.', reason: 'bad-input' }, 400)
    }
    if (!isAllowed(parsed)) {
      return json({ error: 'That host is not supported.', reason: 'bad-host' }, 400)
    }

    // Already canonical? Nothing to do but tidy it.
    if (isCanonical(parsed)) {
      parsed.search = ''
      parsed.hash = ''
      return json({ url: parsed.toString(), reason: 'already-canonical' })
    }

    const isTikTok = parsed.hostname.toLowerCase().endsWith('tiktok.com')

    const resolved =
      await followAuto(url, 'HEAD') ??
      await followAuto(url, 'GET') ??
      await followManual(url) ??
      (isTikTok ? await viaOembed(url) : null)

    if (!resolved) {
      // 502 rather than 400: the request was fine, the upstream would not
      // co-operate. The client treats this as "post it anyway with the short
      // link" rather than losing the user's tip.
      return json({
        error: 'Could not expand that link.',
        reason: 'upstream-refused',
      }, 502)
    }

    // Strip tracking params so the stored link stays clean.
    resolved.search = ''
    resolved.hash = ''
    return json({ url: resolved.toString(), reason: 'resolved' })
  } catch (e) {
    console.error('resolve-link failed:', e)
    return json({ error: 'Could not resolve that link.', reason: 'error' }, 500)
  }
})
