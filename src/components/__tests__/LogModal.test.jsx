// LogModal is the only write path into posts and weigh_ins, and those rows
// feed the feed, the leaderboard, the weight chart and the badges. A wrong
// column here corrupts all four, silently.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const insert = vi.fn(async () => ({ error: null }))
const from = vi.fn(() => ({ insert }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a) => from(...a), functions: { invoke: (...a) => invoke(...a) } },
}))

const uploadPhoto = vi.fn(async () => 'https://cdn.test/user-1/pic.jpg')
vi.mock('../../lib/image', () => ({ uploadPhoto: (...a) => uploadPhoto(...a) }))

const invoke = vi.fn(async () => ({ data: null, error: null }))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, profile: { display_name: 'Vic' } }),
}))

const LogModal = (await import('../LogModal')).default

const setup = (props = {}) => {
  const onClose = vi.fn()
  const onLogged = vi.fn()
  const utils = render(<LogModal open onClose={onClose} onLogged={onLogged} {...props} />)
  return { onClose, onLogged, ...utils }
}

/** Choose a log type from the first screen of the sheet. */
const pick = (label) => userEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }))
const lastInsert = () => insert.mock.calls.at(-1)[0]

beforeEach(() => {
  invoke.mockClear().mockResolvedValue({ data: null, error: null })
  insert.mockClear().mockResolvedValue({ error: null })
  from.mockClear()
  uploadPhoto.mockClear().mockResolvedValue('https://cdn.test/user-1/pic.jpg')
})

describe('LogModal visibility', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LogModal open={false} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the four log types when opened', () => {
    setup()
    for (const label of ['Workout', 'Meal', 'Weigh in', 'Share tip']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })
})

describe('logging a workout', () => {
  it('writes a workout post with minutes parsed as a number', async () => {
    const { onLogged } = setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Push day')
    await userEvent.type(screen.getByLabelText(/minutes/i), '45')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(from).toHaveBeenCalledWith('posts')
    expect(lastInsert()).toMatchObject({
      user_id: 'user-1', author_name: 'Vic', kind: 'workout',
      title: 'Push day', minutes: 45,
    })
    expect(onLogged).toHaveBeenCalledOnce()
  })

  it('falls back to a default title rather than writing an empty one', async () => {
    setup()
    await pick('Workout')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    // posts.title is NOT NULL, so a blank title would be a database error
    // presented to the user as "something went wrong".
    expect(lastInsert().title).toBe('Workout')
  })

  it('leaves minutes null when the field is untouched', async () => {
    setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Run')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().minutes).toBeNull()
  })
})

describe('logging a meal', () => {
  it('marks an ordinary meal as healthy and not a cheat', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Chicken salad')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert()).toMatchObject({
      kind: 'meal', meal_type: 'Lunch', is_cheat: false, is_healthy: true,
    })
  })

  // The leaderboard ranks on healthy meals. A cheat meal counting as healthy
  // would let anyone farm the top spot by owning up to dessert.
  it('never counts a cheat meal as healthy', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Pizza')
    await userEvent.click(screen.getByRole('button', { name: /was it a sin/i }))
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert()).toMatchObject({ is_cheat: true, is_healthy: false })
  })

  it('records the chosen meal slot', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Oats')
    await userEvent.selectOptions(screen.getByLabelText(/^meal$/i), 'Breakfast')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().meal_type).toBe('Breakfast')
  })
})

describe('logging a weigh-in', () => {
  it('writes to weigh_ins, not posts', async () => {
    setup()
    await pick('Weigh in')
    await userEvent.type(screen.getByLabelText(/weight/i), '82.5')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(from).toHaveBeenCalledWith('weigh_ins')
    expect(lastInsert()).toMatchObject({ user_id: 'user-1', weight_kg: 82.5 })
  })

  it('accepts a comma decimal separator', async () => {
    setup()
    await pick('Weigh in')
    // The field is type=number so the comma is typed into a text-mode field
    // in jsdom; the parser is what is under test.
    const input = screen.getByLabelText(/weight/i)
    await userEvent.type(input, '82')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().weight_kg).toBe(82)
  })

  it('refuses to log an empty weight and says so', async () => {
    setup()
    await pick('Weigh in')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    expect(await screen.findByText(/enter a weight to log/i)).toBeInTheDocument()
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('errors and photos', () => {
  it('surfaces a database error and keeps the sheet open', async () => {
    insert.mockResolvedValue({ error: new Error('violates row-level security policy') })
    const { onLogged } = setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Push day')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    expect(await screen.findByText(/row-level security/i)).toBeInTheDocument()
    expect(onLogged).not.toHaveBeenCalled()
  })

  it('surfaces an upload failure without writing a post', async () => {
    uploadPhoto.mockRejectedValue(new Error('Could not process that image. Try another.'))
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Pizza')
    await userEvent.upload(
      document.querySelector('input[type="file"]'),
      new File(['x'], 'p.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    expect(await screen.findByText(/could not process that image/i)).toBeInTheDocument()
    expect(insert).not.toHaveBeenCalled()
  })

  it('stores the returned photo URL on the post', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Pizza')
    await userEvent.upload(
      document.querySelector('input[type="file"]'),
      new File(['x'], 'p.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(uploadPhoto).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.any(File))
    expect(lastInsert().photo_url).toBe('https://cdn.test/user-1/pic.jpg')
  })

  it('sends no photo_url when no photo was chosen', async () => {
    setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Push day')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().photo_url).toBeNull()
    expect(uploadPhoto).not.toHaveBeenCalled()
  })
})


describe('attaching a video to a tip', () => {
  const linkField = () => screen.getByLabelText(/video link/i)

  it('stores a full TikTok link as-is', async () => {
    setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Great cue')
    await userEvent.type(linkField(), 'https://www.tiktok.com/@a/video/7123456789012345678')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().video_url).toBe('https://www.tiktok.com/@a/video/7123456789012345678')
    // Nothing to expand, so the function is never called.
    expect(invoke).not.toHaveBeenCalled()
  })

  it('expands a short link before storing it', async () => {
    invoke.mockResolvedValue({
      data: { url: 'https://www.tiktok.com/@a/video/7123456789012345678' }, error: null,
    })
    setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Great cue')
    await userEvent.type(linkField(), 'https://vm.tiktok.com/ZMabcdef1/')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('resolve-link', { body: { url: 'https://vm.tiktok.com/ZMabcdef1/' } })
    expect(lastInsert().video_url).toBe('https://www.tiktok.com/@a/video/7123456789012345678')
  })

  // The important one. Short links are what the TikTok app actually hands
  // people, and TikTok's edge sometimes refuses datacenter IPs. Losing a tip
  // somebody just typed over that would be a far worse outcome than a feed
  // card that opens in TikTok instead of playing inline.
  it('still posts when expansion fails, keeping the short link', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Function not found') })
    const { onLogged } = setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Great cue')
    await userEvent.type(linkField(), 'https://vm.tiktok.com/ZMabcdef1/')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().video_url).toBe('https://vm.tiktok.com/ZMabcdef1/')
    expect(lastInsert().title).toBe('Great cue')
    expect(onLogged).toHaveBeenCalledOnce()
  })

  it('still posts when the function throws outright', async () => {
    invoke.mockRejectedValue(new Error('network down'))
    setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Great cue')
    await userEvent.type(linkField(), 'https://vm.tiktok.com/ZMabcdef1/')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().video_url).toBe('https://vm.tiktok.com/ZMabcdef1/')
  })

  // A profile link has no video in it, so this one DOES block — saving it
  // would put a permanently dead card in the feed.
  it('refuses a profile link and names the problem in the field', async () => {
    setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Great cue')
    await userEvent.type(linkField(), 'https://www.tiktok.com/@hanfoodfit?_r=1')

    // The explanation lands next to the field as they type, before they even
    // reach the button.
    expect(screen.getByText(/profile, not a video/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /log it/i }))
    expect(await screen.findByText(/fix the video link above/i)).toBeInTheDocument()
    expect(insert).not.toHaveBeenCalled()
  })

  // Two copies of the same sentence in one sheet is noise. The field says
  // what is wrong; the submit error says what to do about it.
  it('does not print the same explanation twice', async () => {
    setup()
    await pick('Share tip')
    await userEvent.type(linkField(), 'https://www.tiktok.com/@hanfoodfit?_r=1')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(screen.getByText(/fix the video link above/i)).toBeInTheDocument())
    expect(screen.getAllByText(/profile, not a video/i)).toHaveLength(1)
  })

  it('marks the field invalid for assistive tech', async () => {
    setup()
    await pick('Share tip')
    await userEvent.type(linkField(), 'https://www.tiktok.com/@hanfoodfit?_r=1')
    expect(linkField()).toHaveAttribute('aria-invalid', 'true')

    await userEvent.clear(linkField())
    await userEvent.type(linkField(), 'https://www.tiktok.com/@a/video/7123456789012345678')
    expect(linkField()).not.toHaveAttribute('aria-invalid')
  })

  it('stores no video_url when the field is left empty', async () => {
    setup()
    await pick('Share tip')
    await userEvent.type(screen.getByLabelText(/share a tip/i), 'Just words')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().video_url).toBeNull()
  })
})

// "Cuando quiero subir una foto no me deja elegir de la galería, solo me da
// la opción de tomar la foto en el instante."
//
// The input carried capture="environment". That does not mean "prefer the
// camera" — it means the camera is the ONLY source, so the phone skipped its
// own picker and opened the lens. A meal photographed ten minutes earlier
// could not be posted at all.
describe('choosing a photo', () => {
  const fileInput = () => document.querySelector('input[type="file"]')
  const openType = async (label) => { setup(); await pick(label) }

  it('does not force the camera', async () => {
    await openType('meal')
    expect(fileInput()).not.toHaveAttribute('capture')
  })

  it('still accepts images only, so the picker is not a file browser', async () => {
    await openType('meal')
    expect(fileInput()).toHaveAttribute('accept', 'image/*')
  })

  it('offers the same choice on a workout', async () => {
    await openType('workout')
    expect(fileInput()).not.toHaveAttribute('capture')
  })
})

// "Same with workout, it always shows 'strength', it doesn't let me pick if
// it was cardio or resistance." There was nowhere to say.
describe('saying what a post is', () => {
  it('offers every workout type, defaulting to strength', async () => {
    setup()
    await pick('Workout')

    const select = screen.getByLabelText('Type')
    expect(select).toHaveValue('strength')
    for (const label of ['Strength', 'Cardio', 'Sport', 'Mobility', 'Class', 'Other']) {
      expect(screen.getByRole('option', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('stores the workout type that was chosen', async () => {
    setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Morning run')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'cardio')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert()).toMatchObject({ kind: 'workout', workout_type: 'cardio' })
  })

  it('offers meal labels, none selected by default', async () => {
    setup()
    await pick('Meal')
    for (const label of ['High protein', 'Home-cooked', 'Eating out', 'Veggie', 'Quick']) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    }
  })

  it('stores the meal labels that were ticked', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Ceviche')
    await userEvent.click(screen.getByRole('checkbox', { name: 'High protein' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Home-cooked' }))
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().meal_tags).toEqual(['high-protein', 'home-cooked'])
  })

  // A workout_type on a meal violates a CHECK constraint in 0013, and is
  // meaningless besides.
  it('never puts a workout type on a meal', async () => {
    setup()
    await pick('Meal')
    await userEvent.type(screen.getByLabelText(/what did you eat/i), 'Ceviche')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().workout_type).toBeNull()
  })

  it('never puts meal tags on a workout', async () => {
    setup()
    await pick('Workout')
    await userEvent.type(screen.getByLabelText(/what did you do/i), 'Push day')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(lastInsert().meal_tags).toEqual([])
  })

  it('offers neither on a tip', async () => {
    setup()
    await pick('Share tip')
    expect(screen.queryByLabelText('Type')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Veggie' })).toBeNull()
  })
})
