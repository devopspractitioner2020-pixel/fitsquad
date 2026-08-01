// The embed is deliberately conservative: nothing loads until the reader
// asks for it, and there is always a way out to the original post. Both of
// those are easy to regress by "simplifying" the component, so they're pinned.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoEmbed from '../VideoEmbed'

const TIKTOK = 'https://www.tiktok.com/@fitcoach/video/7123456789012345678'
const REEL = 'https://www.instagram.com/reel/CxAbCdEfGhI/'
const SHORT = 'https://www.youtube.com/shorts/dQw4w9WgXcQ'

// Report every observed element as on-screen, so the lazy gate opens and the
// click-to-play gate is the only thing left under test.
function stubIntersectionObserver({ intersecting = true } = {}) {
  const instances = []
  class IO {
    constructor(cb) { this.cb = cb; instances.push(this) }
    observe() { this.cb([{ isIntersecting: intersecting }]) }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', IO)
  return instances
}

const frame = () => document.querySelector('iframe')

beforeEach(() => { stubIntersectionObserver() })
afterEach(() => { vi.unstubAllGlobals() })

describe('what renders before a tap', () => {
  it('shows a play button and no iframe', () => {
    render(<VideoEmbed url={TIKTOK} />)
    expect(screen.getByRole('button', { name: /play tiktok video/i })).toBeInTheDocument()
    // The whole point of click-to-play: twenty embeds in a feed must not
    // mount twenty players, and no data is spent on a video nobody watches.
    expect(frame()).toBeNull()
  })

  it('names the platform on the poster', () => {
    render(<VideoEmbed url={REEL} />)
    expect(screen.getByText(/tap to play · instagram/i)).toBeInTheDocument()
  })
})

describe('what renders after a tap', () => {
  it('mounts the official TikTok player', async () => {
    render(<VideoEmbed url={TIKTOK} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))

    const f = frame()
    expect(f).toBeInTheDocument()
    expect(f.getAttribute('src')).toContain('tiktok.com/player/v1/7123456789012345678')
    expect(f).toHaveAttribute('loading', 'lazy')
    expect(f).toHaveAttribute('allowfullscreen')
  })

  it('mounts the no-cookie YouTube player', async () => {
    render(<VideoEmbed url={SHORT} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(frame().getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('does not leak the full referrer to the platform', async () => {
    render(<VideoEmbed url={REEL} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(frame()).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  })
})

describe('the escape hatch', () => {
  // A private or deleted post renders the platform's own error inside the
  // frame, and that is not detectable cross-origin. This link is the only
  // way the reader can tell what happened — it is not decoration.
  it('always offers a link to the original post', () => {
    render(<VideoEmbed url={TIKTOK} />)
    const link = screen.getByRole('link', { name: /open on tiktok/i })
    expect(link).toHaveAttribute('href', TIKTOK)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('survives the reader tapping play', async () => {
    render(<VideoEmbed url={TIKTOK} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(screen.getByRole('link', { name: /open on tiktok/i })).toBeInTheDocument()
  })
})

describe('links it cannot embed', () => {
  it('renders nothing at all for an unsupported URL', () => {
    const { container } = render(<VideoEmbed url="https://vimeo.com/123" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a missing URL', () => {
    const { container } = render(<VideoEmbed url={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Short links are normally expanded at save time. This branch is what the
  // reader sees when that failed — a usable tap-through, not a broken frame.
  // The post itself is never blocked over it.
  it('falls back to a plain link for an unresolved short link', () => {
    render(<VideoEmbed url="https://vm.tiktok.com/ZMabcdef1/" />)
    expect(screen.getByText(/opens in tiktok/i)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://vm.tiktok.com/ZMabcdef1/')
    expect(frame()).toBeNull()
  })

  // The reader did not post it and cannot fix it, so the wording must not
  // instruct them to go and copy a different link.
  it('does not tell the reader to fix a link they did not post', () => {
    render(<VideoEmbed url="https://vm.tiktok.com/ZMabcdef1/" />)
    expect(screen.queryByText(/copy the full link/i)).toBeNull()
  })
})

describe('lazy mounting', () => {
  it('stays a poster while the card is off screen', async () => {
    vi.unstubAllGlobals()
    stubIntersectionObserver({ intersecting: false })
    render(<VideoEmbed url={TIKTOK} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    // Tapped, but never scrolled into view: still nothing loaded.
    expect(frame()).toBeNull()
  })

  it('renders eagerly where IntersectionObserver is unavailable', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<VideoEmbed url={TIKTOK} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    // Degrading to "never plays" would be worse than degrading to eager.
    expect(frame()).toBeInTheDocument()
  })
})
