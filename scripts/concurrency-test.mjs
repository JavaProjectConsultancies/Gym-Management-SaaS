#!/usr/bin/env node
/**
 * Concurrency test against a DEPLOYED Apps Script web app.
 *
 * ⚠ Writes `test.concurrency_*` settings. Run ONLY against a TEST deployment
 *   backed by a TEST spreadsheet — never production. See docs/BACKEND_SETUP.md.
 *
 * Sends N parallel PUTs to distinct setting keys plus N parallel PUTs to one
 * shared key, then reads the settings back and checks:
 *   - every distinct key exists exactly once (no lost writes)
 *   - the shared key exists exactly once (no duplicate rows from a race)
 *
 * Optional (TEST_MEMBERS=yes): N parallel POST /members with the SAME phone number
 * must create exactly one member (the rest 409 MEMBER_PHONE_EXISTS). Members cannot
 * be deleted, so the created test member is deactivated afterwards.
 *
 * Usage (PowerShell):
 *   $env:API_URL="https://script.google.com/macros/s/<id>/exec"
 *   $env:ID_TOKEN="<fresh Firebase ID token of a GYM_OWNER>"
 *   $env:GYM_ID="GYM-..."
 *   $env:CONFIRM_TEST_DEPLOYMENT="yes"
 *   $env:TEST_MEMBERS="yes"        # optional, see above
 *   node scripts/concurrency-test.mjs
 */

const { API_URL, ID_TOKEN, GYM_ID, CONFIRM_TEST_DEPLOYMENT } = process.env
const N = Number(process.env.N ?? 8)

if (!API_URL || !ID_TOKEN || !GYM_ID) {
  console.error('Set API_URL, ID_TOKEN and GYM_ID. See the header of this file.')
  process.exit(2)
}
if (CONFIRM_TEST_DEPLOYMENT !== 'yes') {
  console.error('Refusing to run: set CONFIRM_TEST_DEPLOYMENT=yes to confirm this is a TEST deployment.')
  process.exit(2)
}

async function api(method, path, body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ method, path, idToken: ID_TOKEN, body }),
    redirect: 'follow',
  })
  return res.json()
}

const run = Date.now().toString(36)
const base = `/gyms/${GYM_ID}/settings`
const distinctKeys = Array.from({ length: N }, (_, i) => `test.concurrency_${run}_${i}`)
const sharedKey = `test.concurrency_${run}_shared`

console.log(`Sending ${N * 2} concurrent writes…`)
const started = Date.now()
const results = await Promise.all([
  ...distinctKeys.map((k, i) => api('PUT', `${base}/${k}`, { value: `v${i}` })),
  ...distinctKeys.map((_, i) => api('PUT', `${base}/${sharedKey}`, { value: `writer-${i}` })),
])
console.log(`Completed in ${Date.now() - started} ms`)

const statusCounts = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {})
console.log('Response statuses:', statusCounts)

const list = await api('GET', base)
if (!list.ok) {
  console.error('Could not read settings back:', list.error)
  process.exit(1)
}

const keys = list.data.settings.map((s) => s.key)
const problems = []
for (const k of distinctKeys) {
  const count = keys.filter((x) => x === k).length
  const writeOk = results[distinctKeys.indexOf(k)].ok
  if (writeOk && count !== 1) problems.push(`${k}: expected 1 row, found ${count}`)
}
const sharedCount = keys.filter((x) => x === sharedKey).length
if (sharedCount !== 1) problems.push(`${sharedKey}: expected 1 row, found ${sharedCount}`)

const timeouts = results.filter((r) => r.error?.code === 'LOCK_TIMEOUT').length
if (timeouts) console.warn(`${timeouts} request(s) hit LOCK_TIMEOUT (acceptable: client should retry).`)

if (process.env.TEST_MEMBERS === 'yes') {
  const phone = '+1555' + String(Date.now()).slice(-7)
  console.log(`Sending ${N} concurrent member creates with one phone number…`)
  const created = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      api('POST', `/gyms/${GYM_ID}/members`, { fullName: `ZZ Concurrency Test ${run} #${i}`, phone, notes: 'Automated concurrency test' }),
    ),
  )
  const wins = created.filter((r) => r.status === 201)
  const counts = created.reduce((acc, r) => ((acc[r.error?.code ?? r.status] = (acc[r.error?.code ?? r.status] ?? 0) + 1), acc), {})
  console.log('Member create results:', counts)
  const found = await api('GET', `/gyms/${GYM_ID}/members`, { search: phone })
  const rows = found.ok ? found.data.total : -1
  if (wins.length !== 1 || rows !== 1) problems.push(`members: expected exactly 1 created and stored, got ${wins.length} created / ${rows} stored`)
  for (const w of wins) await api('PATCH', `/gyms/${GYM_ID}/members/${w.data.member.memberId}`, { status: 'INACTIVE' })
}

if (problems.length) {
  console.error('FAILED:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('PASSED: no lost writes, no duplicate rows.')
