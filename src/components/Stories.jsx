import { useCallback, useEffect, useRef, useState } from 'react'

// A full-screen story player, in the shape everyone already knows from
// Instagram: progress bars along the top, tap the right half to go forward,
// the left half to go back, hold to pause.
//
// Accessibility is the part these usually get wrong. This one:
//   - advances on ArrowRight / ArrowLeft and closes on Escape,
//   - exposes the tap zones as real <button>s with labels, so they are
//     reachable by keyboard and announced rather than being invisible divs,
//   - announces each card through a live region as it comes up,
//   - stops the timer entirely when the reader prefers reduced motion, since
//     an auto-advancing carousel is precisely what that setting is about.

const STORY_MS = 5000
const TICK_MS = 50

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Stories({ cards, onClose, autoplay = true }) {
  const [index, setIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef(null)

  const count = cards?.length ?? 0
  const card = cards?.[index]

  const go = useCallback((next) => {
    if (next < 0) return
    if (next >= count) { onClose?.(); return }
    setIndex(next)
    setElapsed(0)
  }, [count, onClose])

  // Auto-advance. A ticking interval rather than one long timeout because the
  // progress bar has to fill smoothly and pause has to be able to freeze it
  // mid-card rather than restarting it.
  const still = autoplay && !paused && !prefersReducedMotion() && count > 0
  useEffect(() => {
    if (!still) return undefined
    timer.current = setInterval(() => {
      setElapsed((e) => {
        if (e + TICK_MS >= STORY_MS) {
          // Defer: setState during another component's render is a warning,
          // and go() touches the same state this updater returns.
          queueMicrotask(() => go(index + 1))
          return STORY_MS
        }
        return e + TICK_MS
      })
    }, TICK_MS)
    return () => clearInterval(timer.current)
  }, [still, index, go])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go, onClose])

  if (!count || !card) return null

  const pct = (i) => (i < index ? 100 : i > index ? 0 : (elapsed / STORY_MS) * 100)

  return (
    <div
      className="fixed inset-0 z-50 bg-ink flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Weekly recap"
    >
      {/* Progress */}
      <div className="flex gap-1.5 px-4 pt-4" data-testid="story-progress">
        {cards.map((c, i) => (
          <div key={c.id} className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-mint transition-[width] duration-75 ease-linear"
              style={{ width: `${pct(i)}%` }}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={onClose}
          aria-label="Close recap"
          className="w-9 h-9 rounded-full border border-line text-cream grid place-items-center"
        >×</button>
      </div>

      {/* The card. `key` forces a remount so the entrance animation replays. */}
      <div key={card.id} className="flex-1 grid place-items-center px-8 pb-16 text-center">
        <div className="max-w-[420px] w-full story-in">
          <Card card={card} />
        </div>
      </div>

      {/* Screen readers get the content as it changes; the visual card is
          decorative to them because the tap zones sit on top of it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {`${card.eyebrow}. ${card.title}. ${card.subtitle ?? ''}`}
        {card.reactions?.length
          ? ` Reactions: ${card.reactions.map((r) => `${r.count} ${r.emoji}`).join(', ')}.`
          : ''}
        {` (${index + 1} of ${count})`}
      </p>

      {/* Tap zones. Real buttons: keyboard-reachable and announced.
      
          An earlier version disabled pointer events on this strip while an
          embedded video was showing, so taps would reach the player. The Next
          button lives INSIDE the strip, so that disabled the only way
          forward and the story got stuck. There is no embedded video any
          more, and nothing here is ever inert. */}
      <div className="absolute inset-0 top-16 flex">
        <button
          className="w-1/3 h-full"
          aria-label="Previous"
          onClick={() => go(index - 1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        />
        <button
          className="w-2/3 h-full"
          aria-label="Next"
          onClick={() => go(index + 1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        />
      </div>
    </div>
  )
}

function Card({ card }) {
  return (
    <>
      <p className="text-mint uppercase tracking-[0.18em] text-[13px] font-700 mb-3">
        {card.eyebrow}
      </p>

      {card.emoji && <div className="text-[64px] leading-none mb-3" aria-hidden="true">{card.emoji}</div>}

      {card.photo && (
        <img
          src={card.photo}
          alt=""
          className="w-full h-56 object-cover rounded-xl2 border border-line mb-4"
        />
      )}

      {card.photos?.length > 0 && <Collage photos={card.photos} />}

      <h2 className={`font-display font-800 leading-tight mb-2 ${
        card.kind === 'cover' ? 'text-[44px]' : 'text-[34px]'
      }`}>
        {card.title}
      </h2>

      {card.subtitle && <p className="text-muted text-[17px]">{card.subtitle}</p>}

      {/* Which reactions, not how many. "2 reactions" told you the number and
          hid the thing itself. */}
      {card.reactions?.length > 0 && (
        <div className="flex gap-2 justify-center flex-wrap mt-4" data-testid="story-reactions">
          {card.reactions.map((r) => (
            <span
              key={r.emoji}
              className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5"
            >
              <span className="text-[20px]" aria-hidden="true">{r.emoji}</span>
              <span className="text-mint font-700 text-sm">{r.count}</span>
            </span>
          ))}
        </div>
      )}

      {card.stats?.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mt-6">
          {card.stats.map((s) => (
            <div key={s.label} className="bg-card border border-line rounded-xl2 p-4">
              <div className="font-display text-[30px] font-800 text-mint leading-none">{s.value}</div>
              <div className="text-muted text-[12px] uppercase tracking-wide mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// Up to four pictures in one frame, for the cheat-meal card.
//
// The layout changes with the count rather than forcing everything into a
// 2×2 grid: one photo alone in a four-cell grid is a picture with three
// holes punched next to it, and three photos in a 2×2 leaves one. So one
// runs full width, two split it, three put the newest across the top with
// two beneath, and four fill the square.
function Collage({ photos }) {
  const shown = photos.slice(0, 4)
  const n = shown.length

  // Heights are fixed rather than aspect-driven: a story card has a fixed
  // budget of vertical space, and a tall portrait photo would otherwise push
  // the name and the caption off the bottom of the screen.
  const cell = n === 1 ? 'h-56' : n === 2 ? 'h-44' : 'h-28'

  return (
    <div
      className={`grid gap-1.5 mb-4 ${n === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
      data-testid="story-collage"
    >
      {shown.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          className={`w-full ${cell} object-cover rounded-xl2 border border-line ${
            // Three photos: the first spans both columns so nothing is left
            // as an empty cell.
            n === 3 && i === 0 ? 'col-span-2 h-32' : ''
          }`}
        />
      ))}
    </div>
  )
}
