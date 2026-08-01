import { useEffect, useRef, useState } from 'react'
import { parseVideoUrl, embedSrc, embedRatio, PROVIDER_LABEL } from '../lib/embeds'

// Renders a TikTok / Instagram Reel / YouTube Short inline in the feed.
//
// Three things worth knowing:
//
//  1) The iframe is LAZY and click-to-play. A feed with twenty embeds that all
//     mount at once is painfully slow on a phone and burns the reader's data
//     on videos they never watch. The frame is only created after the card
//     scrolls into view AND the reader taps play.
//  2) If the post is private or deleted the platform serves its own error
//     inside the frame. That is not detectable cross-origin, which is why the
//     "Open on <platform>" link below is not decoration — it is the reader's
//     only escape hatch. Do not remove it.
//  3) Nothing here downloads or stores video. The bytes come from the
//     platform's own player and the creator keeps the view.
export default function VideoEmbed({ url }) {
  const parsed = parseVideoUrl(url)
  const [visible, setVisible] = useState(false)
  const [play, setPlay] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    // jsdom and older browsers have no IntersectionObserver; render eagerly
    // rather than showing a poster that can never activate.
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect() } },
      { rootMargin: '300px' }, // start warming up just before it's on screen
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!parsed) return null

  // Short links can't be embedded directly — the video id lives behind a
  // redirect. They're expanded at save time, so this branch only shows when
  // that failed. The wording addresses the READER, who did not post it and
  // cannot fix it: their job is just to tap through.
  if (parsed.needsResolve) {
    return (
      <LinkFallback
        url={url}
        label="TikTok"
        note="This one opens in TikTok rather than playing here."
      />
    )
  }

  const src = embedSrc(parsed)
  const ratio = embedRatio(parsed.provider)
  const label = PROVIDER_LABEL[parsed.provider]

  return (
    <div ref={boxRef} className="my-3">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-black"
        style={{ aspectRatio: ratio, maxHeight: '70vh' }}
      >
        {visible && play ? (
          <iframe
            src={src}
            title={`${label} video`}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 w-full h-full"
            style={{ border: 0 }}
          />
        ) : (
          <button
            onClick={() => setPlay(true)}
            className="absolute inset-0 w-full h-full grid place-items-center bg-panel active:bg-card-2"
            aria-label={`Play ${label} video`}
          >
            <span className="w-16 h-16 rounded-full bg-mint grid place-items-center shadow-glow">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#05201A"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span className="absolute bottom-4 text-muted text-sm">Tap to play · {label}</span>
          </button>
        )}
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-2 text-muted text-sm underline decoration-line underline-offset-4"
      >
        Open on {label}
      </a>
    </div>
  )
}

function LinkFallback({ url, label, note }) {
  return (
    <div className="my-3 bg-card border border-line rounded-2xl p-4">
      <p className="text-cream font-display font-700 mb-1">{label} link</p>
      <p className="text-muted text-sm mb-3">{note}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-mint underline underline-offset-4 break-all text-sm"
      >
        {url}
      </a>
    </div>
  )
}
