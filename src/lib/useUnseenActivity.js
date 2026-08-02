import { useCallback, useEffect, useState } from 'react'
import { getUnseenCount } from './reactions'

// How many reactions have landed on your posts since you last looked.
//
// A hook rather than a prop drilled from App: the count is needed by the
// header on several screens, and each of those mounts independently. It is
// cheap — one aggregate over your own rows.
//
// The Activity screen fires `fitsquad:activity-seen` after marking things
// read, so every mounted header clears at the same moment instead of waiting
// out its own refresh.
export const ACTIVITY_SEEN_EVENT = 'fitsquad:activity-seen'

export function useUnseenActivity(userId) {
  const [unseen, setUnseen] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) { setUnseen(0); return }
    try {
      setUnseen(await getUnseenCount())
    } catch {
      // A badge is not worth an error message. If the count cannot be read —
      // most likely because migration 0010 has not run — the header simply
      // shows no badge.
      setUnseen(0)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const clear = () => setUnseen(0)
    window.addEventListener(ACTIVITY_SEEN_EVENT, clear)
    return () => window.removeEventListener(ACTIVITY_SEEN_EVENT, clear)
  }, [])

  return { unseen, refresh }
}
