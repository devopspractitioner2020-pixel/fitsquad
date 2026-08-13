import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// The embed has its own suite; here it would drag in IntersectionObserver.
vi.mock('../VideoEmbed', () => ({ default: ({ url }) => <div data-testid="embed">{url}</div> }))

import Stories from '../Stories'

const cards = [
  { id: 'cover', kind: 'cover', eyebrow: 'Weekly recap', title: 'The Test Squad', subtitle: '27 Jul – 2 Aug' },
  { id: 'totals', kind: 'stats', eyebrow: 'The week in numbers', title: '23 logs', subtitle: 'across 3 members',
    stats: [{ label: 'Workouts', value: 9 }] },
  { id: 'outro', kind: 'outro', eyebrow: 'Next week', title: 'Same time, same squad' },
]

beforeEach(() => {
  // jsdom has no matchMedia; without it the reduced-motion check throws.
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => vi.useRealTimers())

describe('playing through', () => {
  it('opens on the first card', () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
    expect(screen.queryByText('23 logs')).toBeNull()
  })

  it('advances on a tap to the right', async () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('23 logs')).toBeInTheDocument()
  })

  it('goes back on a tap to the left', async () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
  })

  it('stays put rather than wrapping around at the start', async () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
  })

  it('closes when the last card is passed', async () => {
    const onClose = vi.fn()
    render(<Stories cards={cards} onClose={onClose} autoplay={false} />)
    const next = screen.getByRole('button', { name: 'Next' })
    await userEvent.click(next)
    await userEvent.click(next)
    await userEvent.click(next)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes from the × as well', async () => {
    const onClose = vi.fn()
    render(<Stories cards={cards} onClose={onClose} autoplay={false} />)
    await userEvent.click(screen.getByRole('button', { name: /close recap/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders one progress bar per card', () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByTestId('story-progress').children).toHaveLength(3)
  })

  it('renders nothing at all for an empty recap', () => {
    const { container } = render(<Stories cards={[]} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('auto-advance', () => {
  it('moves on by itself after five seconds', async () => {
    vi.useFakeTimers()
    render(<Stories cards={cards} onClose={vi.fn()} />)
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(5100) })
    expect(screen.getByText('23 logs')).toBeInTheDocument()
  })

  it('does not move when autoplay is off', async () => {
    vi.useFakeTimers()
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
  })

  // An auto-advancing carousel is precisely what this setting is about.
  it('stops entirely for a reader who prefers reduced motion', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.useFakeTimers()
    render(<Stories cards={cards} onClose={vi.fn()} />)

    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
  })
})

// These usually get skipped in story players, which makes them unusable
// with a keyboard or a screen reader.
describe('keyboard and screen readers', () => {
  it('advances and retreats with the arrow keys', async () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('23 logs')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByText('The Test Squad')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Stories cards={cards} onClose={onClose} autoplay={false} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('announces each card, with its position in the set', async () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('The Test Squad')
    expect(screen.getByRole('status')).toHaveTextContent('(1 of 3)')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('status')).toHaveTextContent('(2 of 3)')
  })

  it('is a modal dialog, so focus and background content are handled', () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Weekly recap')
  })

  // The tap zones are real buttons rather than invisible divs, so a keyboard
  // can reach them and a screen reader announces what they do.
  it('exposes the tap zones as labelled controls', () => {
    render(<Stories cards={cards} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()
  })
})

describe('what a card can show', () => {
  it('renders stats when it has them', () => {
    render(<Stories cards={[cards[1]]} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('Workouts')).toBeInTheDocument()
  })

  it('renders a photo when there is one', () => {
    render(
      <Stories
        cards={[{ id: 'p1', kind: 'post', eyebrow: 'Most loved', title: 'Ceviche', photo: 'https://x/y.jpg' }]}
        onClose={vi.fn()} autoplay={false}
      />,
    )
    // Decorative: the title beside it already says what the picture is, and
    // a duplicate announcement is noise.
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://x/y.jpg')
    expect(document.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('renders an emoji when there is one', () => {
    render(
      <Stories
        cards={[{ id: 'c', kind: 'champion', eyebrow: 'Most consistent', title: 'Vic', emoji: '🏆' }]}
        onClose={vi.fn()} autoplay={false}
      />,
    )
    expect(screen.getByText('🏆')).toBeInTheDocument()
  })
})

// "It is better you show the reactions than just mention the number."
describe('reactions on a card', () => {
  const withReactions = [{
    id: 'p', kind: 'post', eyebrow: 'Plate of the week', title: 'Ceviche', subtitle: 'Diego',
    reactions: [{ emoji: '🤤', count: 3 }, { emoji: '🔥', count: 1 }],
  }]

  it('shows each emoji with its own count', () => {
    render(<Stories cards={withReactions} onClose={vi.fn()} autoplay={false} />)
    const row = screen.getByTestId('story-reactions')
    expect(row).toHaveTextContent('3')
    expect(row).toHaveTextContent('1')
    expect(row.textContent).toContain('🤤')
    expect(row.textContent).toContain('🔥')
  })

  it('does not print a bare total anywhere', () => {
    render(<Stories cards={withReactions} onClose={vi.fn()} autoplay={false} />)
    expect(screen.queryByText(/4 reactions/)).toBeNull()
  })

  it('reads them out to a screen reader', () => {
    render(<Stories cards={withReactions} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Reactions: 3 🤤, 1 🔥')
  })

  it('shows no row at all when a card has none', () => {
    render(<Stories cards={[{ id: 'c', kind: 'cover', eyebrow: 'x', title: 'y' }]} onClose={vi.fn()} autoplay={false} />)
    expect(screen.queryByTestId('story-reactions')).toBeNull()
  })
})

// The card used to render the title alone — "Dinner" for an Instagram video
// of somebody making dinner.
describe('a card whose post is a video', () => {
  const videoCard = [{
    id: 'p', kind: 'post', eyebrow: 'Tip worth keeping', title: 'Dinner', subtitle: 'Kati',
    video: 'https://www.instagram.com/reel/abc/',
  }, { id: 'next', kind: 'outro', eyebrow: 'Next', title: 'Done' }]

  it('embeds the video', () => {
    render(<Stories cards={videoCard} onClose={vi.fn()} autoplay={false} />)
    expect(screen.getByTestId('embed')).toHaveTextContent('https://www.instagram.com/reel/abc/')
  })

  // Five seconds is not enough to watch anything, and pulling a video off
  // screen mid-play is worse than asking for a tap.
  it('does not auto-advance past it', async () => {
    vi.useFakeTimers()
    render(<Stories cards={videoCard} onClose={vi.fn()} />)

    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(screen.getByText('Dinner')).toBeInTheDocument()
  })

  it('says why it is paused', () => {
    render(<Stories cards={videoCard} onClose={vi.fn()} />)
    expect(screen.getByText(/paused/i)).toBeInTheDocument()
  })

  it('still advances by tap and by keyboard', async () => {
    render(<Stories cards={videoCard} onClose={vi.fn()} autoplay={false} />)
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('resumes auto-advance on the next card', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<Stories cards={videoCard} onClose={onClose} />)

    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Dinner')).toBeInTheDocument()

    // Move past the video by hand; the outro then times out on its own.
    await act(async () => { screen.getByRole('button', { name: 'Next' }).click() })
    await act(async () => { vi.advanceTimersByTime(5200) })
    expect(onClose).toHaveBeenCalled()
  })
})
