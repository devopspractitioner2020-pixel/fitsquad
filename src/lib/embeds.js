// Detects a supported video link and returns the info needed to embed it.
//
// We never download or store the video — we point an iframe at the platform's
// own player, so the video streams from their servers and the creator keeps
// the view and the attribution. This is the officially supported route, and
// the only one that does not violate TikTok's and Instagram's terms.
//
// If a future request asks for a "download this video" button, the answer is
// no: it would mean redistributing someone else's copyrighted work from our
// own infrastructure, off signed CDN URLs that rotate every few weeks.

const PATTERNS = [
  // TikTok full URL: tiktok.com/@user/video/7123456789012345678
  {
    provider: 'tiktok',
    re: /tiktok\.com\/@[\w.-]+\/video\/(\d+)/i,
    id: (m) => m[1],
  },
  // TikTok short links (vm.tiktok.com/XXXX, vt.tiktok.com/XXXX, tiktok.com/t/XXXX).
  // The real video ID sits behind a redirect the browser can't follow due to
  // CORS, so these are resolved server-side at save time.
  {
    provider: 'tiktok-short',
    re: /(?:vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t)\/([\w]+)/i,
    id: (m) => m[1],
    needsResolve: true,
  },
  // Instagram Reel / post / IGTV: instagram.com/reel/ABC123/
  {
    provider: 'instagram',
    re: /instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i,
    id: (m) => m[1],
  },
  // YouTube Shorts + normal watch URLs + youtu.be short links.
  {
    provider: 'youtube',
    re: /(?:youtube\.com\/shorts\/|youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i,
    id: (m) => m[1],
  },
]

/**
 * Near-misses: links that ARE from a supported platform but point at
 * something that has no single video to embed. These exist purely so the
 * error message can say what is actually wrong.
 *
 * A profile link is by far the most common paste. TikTok's "Share profile"
 * gives `tiktok.com/@user?_r=1&_t=…`, which looks close enough to a video
 * link that "that link isn't recognised" reads like a bug in the app.
 */
const NEAR_MISSES = [
  {
    re: /tiktok\.com\/@[\w.-]+\/?(?:\?|$)/i,
    reason: 'tiktok-profile',
    message: 'That is a TikTok profile, not a video. Open the video itself, then Share → Copy link.',
  },
  {
    re: /youtube\.com\/(?:@|c\/|channel\/|user\/)/i,
    reason: 'youtube-channel',
    message: 'That is a YouTube channel, not a video. Open the video and copy its link.',
  },
  {
    re: /instagram\.com\/(?!reel|reels|p\/|tv\/)[\w.]+\/?(?:\?|$)/i,
    reason: 'instagram-profile',
    message: 'That is an Instagram profile, not a Reel. Open the Reel itself and copy its link.',
  },
]

/**
 * Pull the first https URL out of pasted text.
 *
 * Mobile share sheets often hand over a caption with the link inside it
 * ("Check out this video! https://…"), and rejecting that as unrecognised
 * would be pedantic when the link is right there.
 */
function extractUrl(raw) {
  const m = String(raw).match(/https:\/\/[^\s<>"']+/i)
  return m ? m[0] : String(raw).trim()
}

/**
 * Returns { provider, id, needsResolve, url } or null if unsupported.
 *
 * Only https is accepted. The parsed id ends up interpolated into an iframe
 * src, so a `javascript:` or `data:` URL must never make it through — the
 * patterns wouldn't match one anyway, but the scheme check makes that
 * explicit rather than incidental.
 */
export function parseVideoUrl(url) {
  if (!url || typeof url !== 'string') return null
  const clean = extractUrl(url)
  if (!/^https:\/\//i.test(clean)) return null
  for (const p of PATTERNS) {
    const m = clean.match(p.re)
    if (m) return { provider: p.provider, id: p.id(m), needsResolve: !!p.needsResolve, url: clean }
  }
  return null
}

/**
 * Why a link was rejected, in words a person can act on.
 *
 * "That link isn't recognised. Use a TikTok URL" is actively confusing when
 * the user DID paste a TikTok URL — it just happened to be a profile. This
 * distinguishes the cases so the message names the actual problem and the
 * fix.
 */
export function explainVideoUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return { ok: false, reason: 'empty', message: '' }

  const parsed = parseVideoUrl(raw)
  if (parsed) {
    return {
      ok: true,
      reason: 'ok',
      provider: parsed.provider,
      message: parsed.needsResolve
        ? 'TikTok short link — we\'ll expand it when you post.'
        : `${PROVIDER_LABEL[parsed.provider]} video detected — it'll play right in the feed.`,
    }
  }

  const clean = extractUrl(raw)

  for (const n of NEAR_MISSES) {
    if (n.re.test(clean)) return { ok: false, reason: n.reason, message: n.message }
  }

  if (/^http:\/\//i.test(clean)) {
    return {
      ok: false,
      reason: 'insecure',
      message: 'That link is http. Use the https version and it will work.',
    }
  }

  if (!/^https:\/\//i.test(clean)) {
    return {
      ok: false,
      reason: 'not-a-url',
      message: 'That does not look like a link. Paste the full URL, starting with https://',
    }
  }

  return {
    ok: false,
    reason: 'unsupported',
    message: 'Only TikTok, Instagram Reels and YouTube are supported for now.',
  }
}

/** Builds the iframe src for a parsed link. */
export function embedSrc({ provider, id } = {}) {
  switch (provider) {
    case 'tiktok':
      return `https://www.tiktok.com/player/v1/${id}?music_info=1&description=1&rel=0`
    case 'instagram':
      // Instagram's own embed route — public posts only, no token needed.
      return `https://www.instagram.com/reel/${id}/embed`
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`
    default:
      return null
  }
}

/** Aspect ratio per provider so the card doesn't jump while loading. */
export function embedRatio(provider) {
  if (provider === 'youtube') return '16 / 9'
  return '9 / 16' // TikTok and Reels are vertical
}

export const PROVIDER_LABEL = {
  tiktok: 'TikTok',
  'tiktok-short': 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}
