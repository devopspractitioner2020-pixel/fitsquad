// URL parsing is where a video feature quietly breaks: a regex that misses a
// URL shape shows the user "link not recognised" for a perfectly good link,
// and one that is too loose builds an iframe src out of something it
// shouldn't. Both fail silently in the feed, so they are pinned here.
import { describe, it, expect } from 'vitest'
import {
  parseVideoUrl, explainVideoUrl, embedSrc, embedRatio, PROVIDER_LABEL,
} from '../embeds'

describe('parseVideoUrl — TikTok', () => {
  it('reads the video id out of a full URL', () => {
    const p = parseVideoUrl('https://www.tiktok.com/@fitcoach/video/7123456789012345678')
    expect(p).toMatchObject({ provider: 'tiktok', id: '7123456789012345678', needsResolve: false })
  })

  it('handles usernames with dots, dashes and underscores', () => {
    for (const user of ['fit.coach', 'fit-coach', 'fit_coach_99']) {
      expect(parseVideoUrl(`https://www.tiktok.com/@${user}/video/7123456789012345678`)?.provider)
        .toBe('tiktok')
    }
  })

  it('survives the tracking junk TikTok appends to shared links', () => {
    const p = parseVideoUrl('https://www.tiktok.com/@fitcoach/video/7123456789012345678?is_from_webapp=1&sender_device=pc')
    expect(p.id).toBe('7123456789012345678')
  })

  it('works without the www subdomain', () => {
    expect(parseVideoUrl('https://tiktok.com/@a/video/7000000000000000000')?.provider).toBe('tiktok')
  })

  // Short links carry no video id — it lives behind a redirect the browser
  // can't follow. Flagging them is what triggers server-side resolution.
  it('flags short links as needing resolution', () => {
    for (const url of [
      'https://vm.tiktok.com/ZMabcdef1/',
      'https://vt.tiktok.com/ZSabcdef2/',
      'https://www.tiktok.com/t/ZTabcdef3/',
    ]) {
      expect(parseVideoUrl(url), url).toMatchObject({ provider: 'tiktok-short', needsResolve: true })
    }
  })

  it('prefers the full-URL pattern over the short-link one', () => {
    // Both patterns could plausibly match a full tiktok.com URL; order matters.
    expect(parseVideoUrl('https://www.tiktok.com/@a/video/7123456789012345678').needsResolve)
      .toBe(false)
  })
})

describe('parseVideoUrl — Instagram', () => {
  it('reads a Reel shortcode', () => {
    expect(parseVideoUrl('https://www.instagram.com/reel/CxAbCdEfGhI/'))
      .toMatchObject({ provider: 'instagram', id: 'CxAbCdEfGhI' })
  })

  it('accepts the other post shapes Instagram uses', () => {
    for (const path of ['reel', 'reels', 'p', 'tv']) {
      expect(parseVideoUrl(`https://www.instagram.com/${path}/AbCd1234_-x/`)?.provider, path)
        .toBe('instagram')
    }
  })

  it('keeps shortcodes containing dashes and underscores intact', () => {
    expect(parseVideoUrl('https://www.instagram.com/reel/Ab-Cd_1234/')?.id).toBe('Ab-Cd_1234')
  })
})

describe('parseVideoUrl — YouTube', () => {
  it('reads a Short', () => {
    expect(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('reads a normal watch URL and a youtu.be link', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
  })
})

describe('parseVideoUrl — what it refuses', () => {
  it('returns null for unsupported hosts', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')).toBeNull()
    expect(parseVideoUrl('https://example.com/video.mp4')).toBeNull()
  })

  it('returns null for junk input', () => {
    for (const v of [null, undefined, '', '   ', 42, {}, 'not a url at all']) {
      expect(parseVideoUrl(v)).toBeNull()
    }
  })

  // The parsed value ends up interpolated into an iframe src. Anything that
  // isn't https must never get that far.
  it('refuses non-https schemes, including ones that embed a real host', () => {
    for (const v of [
      'http://www.tiktok.com/@a/video/7123456789012345678',
      'javascript:alert(1)//tiktok.com/@a/video/123',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(parseVideoUrl(v), v).toBeNull()
    }
  })

  it('is not fooled by a lookalike domain', () => {
    expect(parseVideoUrl('https://tiktok.com.evil.test/@a/video/123')).toBeNull()
  })
})

describe('embedSrc', () => {
  it('builds the official TikTok player URL', () => {
    const src = embedSrc({ provider: 'tiktok', id: '7123456789012345678' })
    expect(src).toBe('https://www.tiktok.com/player/v1/7123456789012345678?music_info=1&description=1&rel=0')
  })

  it('builds the Instagram embed path', () => {
    expect(embedSrc({ provider: 'instagram', id: 'CxAbCdEfGhI' }))
      .toBe('https://www.instagram.com/reel/CxAbCdEfGhI/embed')
  })

  // youtube-nocookie is deliberate: no tracking cookie is set unless the
  // reader actually plays the video.
  it('builds a no-cookie YouTube embed that plays inline on mobile', () => {
    const src = embedSrc({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(src).toContain('playsinline=1')
  })

  it('returns null for a provider it cannot embed', () => {
    expect(embedSrc({ provider: 'tiktok-short', id: 'ZMabcdef1' })).toBeNull()
    expect(embedSrc({ provider: 'vimeo', id: '1' })).toBeNull()
    expect(embedSrc()).toBeNull()
  })

  // Every embeddable src must be on a host the CSP frame-src allows, or the
  // iframe goes blank with no console error pointing at the cause.
  it('only ever produces hosts allowed by the CSP', () => {
    const allowed = ['www.tiktok.com', 'www.instagram.com', 'www.youtube-nocookie.com']
    for (const provider of ['tiktok', 'instagram', 'youtube']) {
      const { hostname } = new global.URL(embedSrc({ provider, id: 'abc123' }))
      expect(allowed, provider).toContain(hostname)
    }
  })
})

describe('embedRatio', () => {
  it('is landscape for YouTube and portrait for the vertical platforms', () => {
    expect(embedRatio('youtube')).toBe('16 / 9')
    expect(embedRatio('tiktok')).toBe('9 / 16')
    expect(embedRatio('instagram')).toBe('9 / 16')
  })
})

describe('PROVIDER_LABEL', () => {
  it('names every provider the parser can return', () => {
    for (const p of ['tiktok', 'tiktok-short', 'instagram', 'youtube']) {
      expect(PROVIDER_LABEL[p], p).toBeTruthy()
    }
  })

  it('calls a short link TikTok too, so the UI never says "tiktok-short"', () => {
    expect(PROVIDER_LABEL['tiktok-short']).toBe('TikTok')
  })
})


// Regression: the first real user pasted a TikTok PROFILE link and was told
// "that link isn't recognised — use a TikTok URL", which is both true and
// useless. The rejection was right; the message named the wrong problem.
describe('explainVideoUrl — near misses', () => {
  it('calls a TikTok profile link what it is, and says how to fix it', () => {
    const v = explainVideoUrl('https://www.tiktok.com/@hanfoodfit?_r=1&_t=ZN-98Ornh4OaVa')
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('tiktok-profile')
    expect(v.message).toMatch(/profile, not a video/i)
    expect(v.message).toMatch(/share/i) // tells them where to get the right link
  })

  it('recognises a bare profile link with no tracking params', () => {
    expect(explainVideoUrl('https://www.tiktok.com/@hanfoodfit').reason).toBe('tiktok-profile')
    expect(explainVideoUrl('https://www.tiktok.com/@hanfoodfit/').reason).toBe('tiktok-profile')
  })

  it('does not mistake a real video link for a profile', () => {
    const v = explainVideoUrl('https://www.tiktok.com/@hanfoodfit/video/7123456789012345678')
    expect(v.ok).toBe(true)
    expect(v.reason).toBe('ok')
  })

  it('spots an Instagram profile and a YouTube channel too', () => {
    expect(explainVideoUrl('https://www.instagram.com/hanfoodfit/').reason).toBe('instagram-profile')
    expect(explainVideoUrl('https://www.youtube.com/@somechannel').reason).toBe('youtube-channel')
    expect(explainVideoUrl('https://www.youtube.com/channel/UCabc123').reason).toBe('youtube-channel')
  })

  it('still accepts the Reel and Short shapes', () => {
    expect(explainVideoUrl('https://www.instagram.com/reel/CxAbCdEfGhI/').ok).toBe(true)
    expect(explainVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').ok).toBe(true)
  })
})

describe('explainVideoUrl — other rejections', () => {
  it('points at the https version rather than shrugging', () => {
    const v = explainVideoUrl('http://www.tiktok.com/@a/video/7123456789012345678')
    expect(v.reason).toBe('insecure')
    expect(v.message).toMatch(/https/i)
  })

  it('says it does not look like a link at all', () => {
    expect(explainVideoUrl('yummy food').reason).toBe('not-a-url')
  })

  it('names the supported platforms for an unsupported host', () => {
    const v = explainVideoUrl('https://vimeo.com/123456')
    expect(v.reason).toBe('unsupported')
    expect(v.message).toMatch(/tiktok/i)
  })

  it('says nothing at all for an empty field', () => {
    expect(explainVideoUrl('')).toMatchObject({ reason: 'empty', message: '' })
    expect(explainVideoUrl('   ').message).toBe('')
    expect(explainVideoUrl(null).reason).toBe('empty')
  })

  it('confirms a short link and explains what will happen to it', () => {
    const v = explainVideoUrl('https://vm.tiktok.com/ZMabcdef1/')
    expect(v.ok).toBe(true)
    expect(v.message).toMatch(/expand/i)
  })
})

// Mobile share sheets hand over a caption with the link inside it. Rejecting
// that as unrecognised is pedantic when the link is right there.
describe('links pasted inside surrounding text', () => {
  it('finds the URL in a shared caption', () => {
    const p = parseVideoUrl('Check out this recipe! https://www.tiktok.com/@a/video/7123456789012345678 so good')
    expect(p).toMatchObject({ provider: 'tiktok', id: '7123456789012345678' })
  })

  it('normalises to just the URL, dropping the caption', () => {
    const p = parseVideoUrl('look → https://www.youtube.com/shorts/dQw4w9WgXcQ')
    expect(p.url).toBe('https://www.youtube.com/shorts/dQw4w9WgXcQ')
  })

  it('copes with newlines and stray whitespace', () => {
    expect(parseVideoUrl('\n  https://www.instagram.com/reel/CxAbCdEfGhI/  \n')?.provider)
      .toBe('instagram')
  })

  // Extraction must not become a way to smuggle a non-https scheme through.
  it('does not rescue a javascript: payload that mentions a host', () => {
    expect(parseVideoUrl('javascript:alert(1)//tiktok.com/@a/video/123')).toBeNull()
  })
})
