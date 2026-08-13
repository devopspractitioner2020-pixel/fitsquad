// Does the database the app talks to actually exist?
//
// Every other test in this repo mocks Supabase, which means they all pass
// happily while the client calls a table or a function that no migration
// ever creates. That is not a hypothetical: it is where the last several
// bugs in this project lived —
//
//   * `create_squad()` existed in the database and nothing ever called it,
//     so people with no squad had no way to get one;
//   * `saved_posts` was called by the app before its migration was run, and
//     the only symptom was a 404 in the console;
//   * `handle_new_user()` was defined twice and the second definition won.
//
// This reads the client source and the SQL as text and checks they agree. It
// cannot run Postgres, so it proves names and not behaviour — but a name
// that does not exist is the failure mode that reaches production silently.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(__dirname, '../..')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const clientFiles = walk(join(root, 'src'))
  .filter((f) => !f.includes('__tests__'))
const clientSource = clientFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

const migrationDir = join(root, 'supabase/migrations')
const migrationFiles = readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort()
const sql = [
  readFileSync(join(root, 'supabase/schema.sql'), 'utf8'),
  ...migrationFiles.map((f) => readFileSync(join(migrationDir, f), 'utf8')),
].join('\n')

// Comments would otherwise satisfy every check in this file — several of the
// migrations document the queries they replace, in full, in a `--` block.
const liveSql = sql.replace(/^\s*--.*$/gm, '')

const matchAll = (source, re) => [...source.matchAll(re)].map((m) => m[1])
const unique = (xs) => [...new Set(xs)]

const calledRpcs = unique(matchAll(clientSource, /\.rpc\(\s*['"]([a-z0-9_]+)['"]/g))
const usedTables = unique(matchAll(clientSource, /\.from\(\s*['"]([a-z0-9_]+)['"]/g))
  // `.from()` on the storage client takes a bucket, not a table.
  .filter((t) => t !== 'post-photos')
const invokedFunctions = unique(matchAll(clientSource, /functions\.invoke\(\s*['"]([a-z0-9-]+)['"]/g))

const definedFunctions = unique(
  matchAll(liveSql, /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi),
)
const definedTables = unique([
  ...matchAll(liveSql, /create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi),
  ...matchAll(liveSql, /create\s+table\s+public\.([a-z0-9_]+)/gi),
])

describe('every RPC the app calls is defined in SQL', () => {
  it('finds some to check, so a broken scan cannot pass silently', () => {
    expect(calledRpcs.length).toBeGreaterThan(3)
    expect(definedFunctions.length).toBeGreaterThan(3)
  })

  it.each(calledRpcs)('%s', (name) => {
    expect(definedFunctions).toContain(name)
  })

  // The other direction. An RPC nobody calls is not a bug in itself, but
  // every one of them so far has turned out to be a missing feature:
  // create_squad (no way to make a squad), rename_squad (no way to rename
  // one). If this fails, either wire it up or delete it.
  it('has no server-side function the app never uses', () => {
    const internal = [
      // Called by triggers and policies, not by the client.
      'handle_new_user', 'handle_new_user_squad', 'ensure_user_squad',
      'shares_squad_with', 'is_squad_member', 'new_join_code',
      'fail_stuck_plans', 'set_updated_at', 'touch_updated_at',
      // Helpers squad_recap() calls internally. The client has its own
      // copies of both in src/lib/recap.js — the SQL is the authority and
      // the JS only decides what to say while waiting.
      'week_start', 'recap_available_at',
    ]
    const orphans = definedFunctions.filter(
      (f) => !calledRpcs.includes(f) && !internal.includes(f),
    )
    expect(orphans).toEqual([])
  })
})

describe('every table the app reads is defined in SQL', () => {
  it.each(usedTables)('%s', (name) => {
    expect(definedTables).toContain(name)
  })
})

describe('every Edge Function the app invokes exists on disk', () => {
  const deployed = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it.each(invokedFunctions)('%s', (name) => {
    expect(deployed).toContain(name)
  })
})

describe('the migrations are deployable in order', () => {
  it('are numbered without gaps or duplicates', () => {
    const numbers = migrationFiles.map((f) => Number(f.slice(0, 4)))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i] - numbers[i - 1]).toBe(1)
    }
  })

  // A migration nobody is told to run is a migration nobody runs. Every one
  // of the squad bugs reached production this way.
  it('are every one of them listed in DEPLOY.md', () => {
    const deploy = readFileSync(join(root, 'DEPLOY.md'), 'utf8')
    for (const file of migrationFiles) {
      expect(deploy, `${file} is not mentioned in DEPLOY.md`).toContain(file)
    }
  })

  // `create or replace` means the last definition wins. Two migrations
  // defining the same function is how new signups silently stopped joining
  // squads: re-running the earlier file reverted the later one.
  it('warn about it when two of them define the same function', () => {
    const perFile = migrationFiles.map((f) => ({
      file: f,
      fns: unique(matchAll(
        readFileSync(join(migrationDir, f), 'utf8').replace(/^\s*--.*$/gm, ''),
        /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi,
      )),
    }))

    const seen = new Map()
    const clashes = []
    for (const { file, fns } of perFile) {
      for (const fn of fns) {
        if (seen.has(fn)) clashes.push({ fn, first: seen.get(fn), again: file })
        else seen.set(fn, file)
      }
    }

    // Redefinition is legitimate — 0009 deliberately restores
    // handle_new_user. What is not legitimate is doing it without warning
    // the reader of the EARLIER file, who will otherwise re-run it and undo
    // the fix. That warning is the fix for the class of bug, so it is what
    // gets asserted.
    for (const { fn, first } of clashes) {
      const earlier = readFileSync(join(migrationDir, first), 'utf8')
      expect(earlier, `${first} redefines ${fn} later but does not say so`)
        .toMatch(/DO NOT RE-RUN|superseded|replaced by|see 00\d\d/i)
    }
  })
})
