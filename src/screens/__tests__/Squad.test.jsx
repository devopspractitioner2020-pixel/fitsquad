import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const AUTH = { user: { id: 'u1', user_metadata: {} }, profile: { display_name: 'Vic' }, signOut: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => AUTH }))

// Chainable stub for the leaderboard queries.
function query(data) {
  const q = {}
  for (const m of ['select', 'gte', 'order', 'eq']) q[m] = vi.fn(() => q)
  q.then = (resolve) => resolve({ data, error: null })
  return q
}

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: vi.fn(() => query([])) },
}))

import { supabase } from '../../lib/supabase'
import Squad from '../Squad'

const SQUAD = { id: 's1', name: 'The Test Squad', join_code: 'ABC234', role: 'owner', member_count: 3 }
const OTHER = { id: 's2', name: 'Los Fuertes', join_code: 'XYZ789', role: 'member', member_count: 2 }

const member = (user_id, display_name, role = 'member') =>
  ({ user_id, display_name, role, joined_at: '2026-07-01T00:00:00Z' })

// my_squads is called on mount and again after create/join; everything else
// resolves empty unless a test says otherwise.
const withSquads = (...responses) => {
  rpc.mockImplementation((fn) => {
    if (fn === 'my_squads') {
      const next = responses.length > 1 ? responses.shift() : responses[0]
      return Promise.resolve({ data: next, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })
}

// The full picture: which squads you are in, who is in each, and what has
// been logged.
const withState = ({ squads = [SQUAD], rosters = {}, posts = [], weighs = [] }) => {
  rpc.mockImplementation((fn, args) => {
    if (fn === 'my_squads') return Promise.resolve({ data: squads, error: null })
    if (fn === 'squad_roster') {
      return Promise.resolve({ data: rosters[args?.sid] ?? [], error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })
  supabase.from.mockImplementation((table) =>
    query(table === 'posts' ? posts : table === 'weigh_ins' ? weighs : []))
}

const renderSquad = async () => {
  render(<MemoryRouter><Squad /></MemoryRouter>)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('my_squads'))
}

const createBtn = () => screen.getByRole('button', { name: /create my squad/i })

beforeEach(() => {
  rpc.mockReset()
  supabase.from.mockReset().mockImplementation(() => query([]))
  AUTH.user = { id: 'u1', user_metadata: {} }
  AUTH.profile = { display_name: 'Vic' }
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
})

describe('when you are in a squad', () => {
  beforeEach(() => withSquads([SQUAD]))

  it('shows the join code, the member count and both copy buttons', async () => {
    await renderSquad()
    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeInTheDocument()
  })

  it('uses the squad name as the heading', async () => {
    await renderSquad()
    expect(await screen.findByRole('heading', { name: 'The Test Squad' })).toBeInTheDocument()
  })

  it('copies the raw code, not the link, from the code button', async () => {
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /copy code/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC234')
  })

  it('copies an invite link carrying the code', async () => {
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /copy invite link/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('?join=ABC234'))
  })

  // Nothing to create — you already have one.
  it('does not offer to create another', async () => {
    await renderSquad()
    await screen.findByText('ABC234')
    expect(screen.queryByRole('button', { name: /create my squad/i })).toBeNull()
  })
})

// The reported bug. One account showed a join code and another showed
// nothing at all — no code, no member count, no explanation, and the only
// action on the screen was "join another squad with a code", which needs a
// code you would have to go and ask someone else for.
describe('when you are in no squad', () => {
  beforeEach(() => withSquads([]))

  it('says so, instead of rendering an empty space', async () => {
    await renderSquad()
    expect(await screen.findByText(/not in a squad yet/i)).toBeInTheDocument()
  })

  it('offers to create one — the way out that did not exist', async () => {
    await renderSquad()
    expect(await createBtn()).toBeInTheDocument()
  })

  it('creates the squad through the RPC that was already in the database', async () => {
    await renderSquad()
    await userEvent.type(await screen.findByLabelText(/squad name/i), 'Los Fuertes')
    await userEvent.click(createBtn())

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: 'Los Fuertes' }))
  })

  it('falls back to a name built from your own, so the field can be left blank', async () => {
    await renderSquad()
    await userEvent.click(await createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "Vic's Squad" }))
  })

  it('does not send a name of pure whitespace', async () => {
    await renderSquad()
    await userEvent.type(await screen.findByLabelText(/squad name/i), '   ')
    await userEvent.click(createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "Vic's Squad" }))
  })

  it('copes with a profile that has no display name', async () => {
    AUTH.profile = null
    await renderSquad()
    await userEvent.click(await createBtn())
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_squad', { squad_name: "My's Squad" }))
  })

  it('shows the new join code once the squad exists', async () => {
    withSquads([], [SQUAD])
    await renderSquad()
    await userEvent.click(await createBtn())

    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()
  })

  it('surfaces a failure rather than silently doing nothing', async () => {
    rpc.mockImplementation((fn) =>
      fn === 'my_squads'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: { message: 'permission denied' } }))

    await renderSquad()
    await userEvent.click(await createBtn())
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
  })

  // Joining someone else's squad is still there — creating is an addition,
  // not a replacement.
  it('still offers to join an existing squad with a code', async () => {
    await renderSquad()
    expect(screen.getByRole('button', { name: /join another squad with a code/i })).toBeInTheDocument()
  })
})

describe('before the answer arrives', () => {
  it('does not flash the create panel at people who do have a squad', async () => {
    let resolve
    rpc.mockImplementation((fn) =>
      fn === 'my_squads'
        ? new Promise((r) => { resolve = r })
        : Promise.resolve({ data: null, error: null }))

    render(<MemoryRouter><Squad /></MemoryRouter>)
    // Nothing is known yet, so nothing is claimed.
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()

    resolve({ data: [SQUAD], error: null })
    expect(await screen.findByText('ABC234')).toBeInTheDocument()
    expect(screen.queryByText(/not in a squad yet/i)).toBeNull()
  })
})

describe('joining with a code', () => {
  beforeEach(() => withSquads([]))

  it('sends the code to join_squad', async () => {
    await renderSquad()
    await userEvent.click(screen.getByRole('button', { name: /join another squad with a code/i }))
    await userEvent.type(screen.getByLabelText(/squad join code/i), 'xyz789')
    await userEvent.click(screen.getByRole('button', { name: /^join squad$/i }))

    // Upper-cased as they type, because the codes are read off screenshots.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('join_squad', { code: 'XYZ789' }))
  })

  it('will not submit a code too short to be one', async () => {
    await renderSquad()
    await userEvent.click(screen.getByRole('button', { name: /join another squad with a code/i }))
    await userEvent.type(screen.getByLabelText(/squad join code/i), 'AB')
    expect(screen.getByRole('button', { name: /^join squad$/i })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------
// The reported failure, in full.
//
// Two people signed up with a valid join code. The owner could not see
// them and they could not see him. Membership was fine — the leaderboard
// was built from posts and weigh-ins, so anyone who had not logged
// anything did not exist on this screen, and when nobody had logged
// anything the screen said "No logs in this range yet" to all three of
// them. The squad is the core of the app, so this is tested from every
// side it can be seen from.
// ---------------------------------------------------------------------
describe('squad members appear whether or not they have logged anything', () => {
  const ME = member('u1', 'Vic', 'owner')
  const HANNAH = member('u2', 'Hannah')
  const STUTTGART = member('u3', 'Klaus')

  it('lists everyone in the squad on a completely empty board', async () => {
    withState({ rosters: { s1: [ME, HANNAH, STUTTGART] } })
    await renderSquad()

    expect(await screen.findByText('Vic')).toBeInTheDocument()
    expect(screen.getByText('Hannah')).toBeInTheDocument()
    expect(screen.getByText('Klaus')).toBeInTheDocument()
  })

  it('never shows the old "no logs" dead end while the squad has members', async () => {
    withState({ rosters: { s1: [ME, HANNAH, STUTTGART] } })
    await renderSquad()

    await screen.findByText('Hannah')
    expect(screen.queryByText(/no logs in this range yet/i)).toBeNull()
  })

  it('says the board is waiting rather than implying the squad is', async () => {
    withState({ rosters: { s1: [ME, HANNAH] } })
    await renderSquad()
    expect(await screen.findByText(/the squad is\s+here/i)).toBeInTheDocument()
  })

  it('shows a member who joined seconds ago, on zero', async () => {
    withState({
      rosters: { s1: [ME, HANNAH] },
      posts: [{ user_id: 'u1', kind: 'workout', is_healthy: null, created_at: '2026-07-30T10:00:00Z' }],
    })
    await renderSquad()

    const hannah = (await screen.findByText('Hannah')).closest('div.flex')
    expect(hannah).toHaveTextContent('🥗 0')
    expect(hannah).toHaveTextContent('🏋️ 0')
  })

  // The squad row still claims member_count 3; the roster has 2. Showing the
  // count from a different query than the list is how "3 members" ends up
  // sitting above a list of one.
  it('counts members from the roster, so the count cannot exceed the list', async () => {
    withState({ rosters: { s1: [ME, HANNAH] } })
    await renderSquad()

    await screen.findByText('Hannah')
    expect(screen.getByTestId('member-count')).toHaveTextContent('2')
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(2)
  })

  it('marks which row is you', async () => {
    withState({ rosters: { s1: [ME, HANNAH] } })
    await renderSquad()
    expect(await screen.findByText('you')).toBeInTheDocument()
  })

  it('ranks by logs and leaves the unlogged at the bottom', async () => {
    withState({
      rosters: { s1: [ME, HANNAH, STUTTGART] },
      posts: [
        { user_id: 'u2', kind: 'workout', created_at: 'x' },
        { user_id: 'u2', kind: 'meal', is_healthy: true, created_at: 'x' },
        { user_id: 'u1', kind: 'workout', created_at: 'x' },
      ],
    })
    await renderSquad()
    await screen.findByText('Hannah')

    // Hannah 2 logs, Vic 1, Klaus 0 — and Klaus is still on the board.
    const order = screen.getAllByTestId('leaderboard-row')
      .map((row) => row.textContent.match(/Hannah|Klaus|Vic/)[0])
    expect(order).toEqual(['Hannah', 'Vic', 'Klaus'])
  })

  it('still counts weigh-ins as presence on the board', async () => {
    withState({
      rosters: { s1: [ME, HANNAH] },
      weighs: [
        { user_id: 'u2', weight_kg: 70, created_at: '2026-07-01' },
        { user_id: 'u2', weight_kg: 68.5, created_at: '2026-07-20' },
      ],
    })
    await renderSquad()

    const hannah = (await screen.findByText('Hannah')).closest('div.flex')
    expect(hannah).toHaveTextContent('-1.5 kg')
  })

  it('asks the database for THIS squad, not for everyone it can see', async () => {
    withState({ rosters: { s1: [ME, HANNAH] } })
    await renderSquad()
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('squad_roster', { sid: 's1' }))
  })

  it('surfaces a roster failure rather than rendering an empty squad', async () => {
    rpc.mockImplementation((fn) => {
      if (fn === 'my_squads') return Promise.resolve({ data: [SQUAD], error: null })
      if (fn === 'squad_roster') return Promise.resolve({ data: null, error: { message: 'permission denied for function squad_roster' } })
      return Promise.resolve({ data: null, error: null })
    })
    await renderSquad()
    expect(await screen.findByText(/permission denied for function squad_roster/i)).toBeInTheDocument()
  })

  it('keeps everyone listed when the range changes to a quiet week', async () => {
    withState({ rosters: { s1: [ME, HANNAH, STUTTGART] } })
    await renderSquad()
    await screen.findByText('Hannah')

    await userEvent.click(screen.getByRole('button', { name: /all-time/i }))
    expect(await screen.findByText('Hannah')).toBeInTheDocument()
    expect(screen.getByText('Klaus')).toBeInTheDocument()
  })
})

describe('being in more than one squad', () => {
  const ME = member('u1', 'Vic', 'owner')
  const HANNAH = member('u2', 'Hannah')
  const KLAUS = member('u3', 'Klaus')

  beforeEach(() => {
    withState({
      squads: [SQUAD, OTHER],
      rosters: { s1: [ME, HANNAH], s2: [ME, KLAUS] },
    })
  })

  it('names both and marks which one you are looking at', async () => {
    await renderSquad()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['The Test Squad', 'Los Fuertes'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('switches roster, join code and board together', async () => {
    await renderSquad()
    expect(await screen.findByText('Hannah')).toBeInTheDocument()
    expect(screen.getByText('ABC234')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Los Fuertes' }))

    expect(await screen.findByText('Klaus')).toBeInTheDocument()
    expect(screen.queryByText('Hannah')).toBeNull()
    // The code shown must belong to the squad shown — handing out the wrong
    // one is exactly how people end up in a squad nobody expected.
    expect(screen.getByText('XYZ789')).toBeInTheDocument()
  })

  it('shows no switcher at all when there is only one squad', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    await screen.findByText('ABC234')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------
// Recovery for the signup bug in migration 0009: two people signed up
// with a valid join code and the database put them in no squad at all,
// because a re-run of migration 0002 had silently replaced the signup
// trigger with a version that knew nothing about squads.
//
// The database fix is the real fix. This is the seatbelt: if it ever
// happens again, the person is one tap from repairing it themselves
// rather than stuck asking the inviter to resend a code.
// ---------------------------------------------------------------------
describe('signed up with a code but landed nowhere', () => {
  beforeEach(() => {
    AUTH.user = { id: 'u1', user_metadata: { join_code: 'cvmkmk' } }
    withState({ squads: [], rosters: {} })
  })

  it('opens the join form with their own code already filled in', async () => {
    await renderSquad()
    const field = await screen.findByLabelText(/squad join code/i)
    expect(field).toHaveValue('CVMKMK')
  })

  it('says what went wrong instead of just offering to create a squad', async () => {
    await renderSquad()
    expect(await screen.findByText(/didn.t take/i)).toBeInTheDocument()
  })

  it('joins the intended squad in one tap', async () => {
    await renderSquad()
    await screen.findByLabelText(/squad join code/i)
    await userEvent.click(screen.getByRole('button', { name: /^join squad$/i }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('join_squad', { code: 'CVMKMK' }))
  })

  it('still lets them start their own squad instead', async () => {
    await renderSquad()
    expect(await createBtn()).toBeInTheDocument()
  })

  it('leaves the join form closed for someone who never used a code', async () => {
    AUTH.user = { id: 'u1', user_metadata: {} }
    withState({ squads: [], rosters: {} })
    await renderSquad()

    await screen.findByText(/not in a squad yet/i)
    expect(screen.queryByLabelText(/squad join code/i)).toBeNull()
    expect(screen.getByText(/create one and you.ll get a join code/i)).toBeInTheDocument()
  })

  it('does not nag someone who signed up with a code and is in a squad', async () => {
    withState({ squads: [SQUAD], rosters: { s1: [member('u1', 'Vic', 'owner')] } })
    await renderSquad()

    await screen.findByText('ABC234')
    expect(screen.queryByText(/didn.t take/i)).toBeNull()
    expect(screen.queryByLabelText(/squad join code/i)).toBeNull()
  })
})

// "How do I change the name of the squad? I can't see that functionality."
// The RLS policy for it has existed since migration 0004; no screen ever
// offered it, so a squad kept the name it was born with forever.
describe('renaming the squad', () => {
  const ME = member('u1', 'Vic', 'owner')

  it('offers Rename to the owner', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    expect(await screen.findByRole('button', { name: /rename/i })).toBeInTheDocument()
  })

  // A member renaming the squad out from under everyone is not a feature.
  it('does not offer it to a plain member', async () => {
    withState({ squads: [{ ...SQUAD, role: 'member' }], rosters: { s1: [ME] } })
    await renderSquad()
    await screen.findByText('ABC234')
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull()
  })

  it('opens pre-filled with the current name, so it is an edit not a retype', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))
    expect(screen.getByLabelText(/squad name/i)).toHaveValue('The Test Squad')
  })

  it('saves through the RPC', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))

    const field = screen.getByLabelText(/squad name/i)
    await userEvent.clear(field)
    await userEvent.type(field, 'Los Fuertes')
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('rename_squad', { sid: 's1', new_name: 'Los Fuertes' }))
  })

  it('trims, and will not save an empty name', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))

    const field = screen.getByLabelText(/squad name/i)
    await userEvent.clear(field)
    expect(screen.getByRole('button', { name: /save name/i })).toBeDisabled()

    await userEvent.type(field, '  Los Fuertes  ')
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('rename_squad', { sid: 's1', new_name: 'Los Fuertes' }))
  })

  it('shows the new name once it is saved', async () => {
    rpc.mockImplementation((fn) => {
      if (fn === 'my_squads') {
        const renamed = rpc.mock.calls.some((c) => c[0] === 'rename_squad')
        return Promise.resolve({ data: [{ ...SQUAD, name: renamed ? 'Los Fuertes' : 'The Test Squad' }], error: null })
      }
      if (fn === 'squad_roster') return Promise.resolve({ data: [ME], error: null })
      return Promise.resolve({ data: null, error: null })
    })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))

    const field = screen.getByLabelText(/squad name/i)
    await userEvent.clear(field)
    await userEvent.type(field, 'Los Fuertes')
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))

    expect(await screen.findByRole('heading', { name: 'Los Fuertes' })).toBeInTheDocument()
  })

  it('surfaces the server refusing, rather than appearing to work', async () => {
    rpc.mockImplementation((fn) => {
      if (fn === 'my_squads') return Promise.resolve({ data: [SQUAD], error: null })
      if (fn === 'squad_roster') return Promise.resolve({ data: [ME], error: null })
      return Promise.resolve({ data: null, error: { message: 'Only the squad owner can rename it.' } })
    })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))

    expect(await screen.findByText(/only the squad owner/i)).toBeInTheDocument()
  })

  it('closes without saving on Cancel', async () => {
    withState({ rosters: { s1: [ME] } })
    await renderSquad()
    await userEvent.click(await screen.findByRole('button', { name: /rename/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByLabelText(/squad name/i)).toBeNull()
    expect(rpc).not.toHaveBeenCalledWith('rename_squad', expect.anything())
  })
})
