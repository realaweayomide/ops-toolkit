// tools.js — the six tools. Plain script (no modules) so index.html works when opened
// straight from disk, not just when served.
//
// Each tool: { id, name, tagline, inputs[], sample[], run(values) -> {html, stat} }

// ─── shared helpers ──────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const table = (rows) => `<table><tbody>${rows.join('')}</tbody></table>`
const row = (...cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
const tag = (text, kind) => `<span class="tag ${kind || ''}">${esc(text)}</span>`
const code = (s) => `<code>${esc(s)}</code>`

// ─── 1. Webhook Payload Inspector ────────────────────────────────────────────
// The thing you actually want when wiring up an integration: every field path and
// its type, flattened, so you know what you can reference.

function inspectPayload([raw]) {
  let data
  try { data = JSON.parse(raw) } catch (e) { throw new Error('Not valid JSON: ' + e.message) }

  const paths = []
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      paths.push({ path, type: `array(${node.length})`, sample: '' })
      if (node.length) walk(node[0], `${path}[0]`)
    } else if (node && typeof node === 'object') {
      if (path) paths.push({ path, type: 'object', sample: '' })
      for (const k of Object.keys(node)) walk(node[k], path ? `${path}.${k}` : k)
    } else {
      paths.push({
        path,
        type: node === null ? 'null' : typeof node,
        sample: node === null ? '' : String(node).slice(0, 60),
      })
    }
  }
  walk(data, '')

  const leaves = paths.filter((p) => !['object'].includes(p.type))
  const rows = paths.map((p) =>
    row(code(p.path || '(root)'), tag(p.type, p.type === 'null' ? 'warn' : ''), esc(p.sample))
  )
  return {
    stat: `${leaves.length} fields`,
    html:
      `<p class="hint">Every field path in the payload — this is what you can reference downstream.</p>` +
      table(rows),
  }
}

// ─── 2. Cron Translator ──────────────────────────────────────────────────────

const CRON_NAMES = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }

function parseField(f, min, max) {
  if (f === '*') return null // any
  const out = new Set()
  for (const part of f.split(',')) {
    const step = part.includes('/') ? Number(part.split('/')[1]) : 1
    const range = part.split('/')[0]
    if (range === '*') { for (let i = min; i <= max; i += step) out.add(i); continue }
    if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      for (let i = a; i <= b; i += step) out.add(i)
      continue
    }
    const n = Number(range)
    if (Number.isNaN(n)) throw new Error(`Can't read "${part}"`)
    out.add(n)
  }
  return out
}

function translateCron([expr]) {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expected 5 fields (minute hour day month weekday), got ${parts.length}`)
  const [mF, hF, domF, monF, dowF] = parts
  const mins = parseField(mF, 0, 59)
  const hrs = parseField(hF, 0, 23)
  const dom = parseField(domF, 1, 31)
  const mon = parseField(monF, 1, 12)
  const dow = parseField(dowF, 0, 6)

  // plain English
  const say = []
  if (!mins && !hrs) say.push('Every minute')
  else if (mins && mins.size === 1 && !hrs) say.push(`At ${[...mins][0]} minutes past every hour`)
  else if (mins && hrs) {
    const times = []
    for (const h of [...hrs].slice(0, 4)) for (const m of [...mins].slice(0, 4)) {
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
    say.push(`At ${times.slice(0, 6).join(', ')}${times.length > 6 ? '…' : ''}`)
  } else if (!mins && hrs) say.push(`Every minute of hour ${[...hrs].join(', ')}`)
  else if (mins && !hrs) say.push(`At minute ${[...mins].join(', ')} of every hour`)

  if (dow) say.push(`on ${[...dow].map((d) => CRON_NAMES[d % 7]).join(', ')}`)
  if (dom) say.push(`on day ${[...dom].join(', ')} of the month`)
  if (mon) say.push(`in month ${[...mon].join(', ')}`)
  if (!dow && !dom && !mon) say.push('every day')

  // next runs — walk forward minute by minute
  const next = []
  const t = new Date(); t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60 && next.length < 5; i++) {
    const ok =
      (!mins || mins.has(t.getMinutes())) &&
      (!hrs || hrs.has(t.getHours())) &&
      (!dom || dom.has(t.getDate())) &&
      (!mon || mon.has(t.getMonth() + 1)) &&
      (!dow || dow.has(t.getDay()))
    if (ok) next.push(new Date(t))
    t.setMinutes(t.getMinutes() + 1)
  }

  return {
    stat: expr.trim(),
    html:
      `<p class="big">${esc(say.join(' '))}</p>` +
      `<p class="hint">Next 5 runs (your local time):</p>` +
      table(next.map((d) => row(code(d.toLocaleString()), ''))) +
      (next.length === 0 ? `<p class="hint warn">No runs found in the next year — check the expression.</p>` : ''),
  }
}

// ─── 3. CSV → Clean JSON ─────────────────────────────────────────────────────

function splitCsvLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const snake = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column'

function coerce(v) {
  const s = v.trim()
  if (s === '') return null
  if (/^(true|yes)$/i.test(s)) return true
  if (/^(false|no)$/i.test(s)) return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  return s
}

function csvToJson([raw]) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('Need a header row and at least one data row')

  const rawHeaders = splitCsvLine(lines[0])
  const seen = new Map()
  const headers = rawHeaders.map((h) => {
    let k = snake(h)
    if (seen.has(k)) { const n = seen.get(k) + 1; seen.set(k, n); k = `${k}_${n}` } else seen.set(k, 1)
    return k
  })

  const issues = []
  rawHeaders.forEach((h, i) => { if (snake(h) !== h) issues.push(`renamed ${code(h)} → ${code(headers[i])}`) })

  const out = []
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line)
    if (cells.length !== headers.length) issues.push(`row ${i + 2} has ${cells.length} cells, expected ${headers.length}`)
    const obj = {}
    headers.forEach((h, j) => (obj[h] = coerce(cells[j] ?? '')))
    out.push(obj)
  })

  return {
    stat: `${out.length} rows · ${headers.length} columns`,
    html:
      (issues.length
        ? `<p class="hint warn">${issues.length} thing${issues.length > 1 ? 's' : ''} cleaned or flagged:</p><ul class="issues">` +
          issues.slice(0, 8).map((i) => `<li>${i}</li>`).join('') + '</ul>'
        : `<p class="hint">Clean — no issues found.</p>`) +
      `<pre class="json">${esc(JSON.stringify(out, null, 2))}</pre>`,
  }
}

// ─── 4. Contact Normalizer ───────────────────────────────────────────────────

function normalizeContacts([raw, cc]) {
  const country = (cc || '+234').trim()
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const rows = []
  let good = 0

  for (const line of lines) {
    const email = (line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0]
    const phoneRaw = (line.match(/\+?[\d][\d\s().-]{6,}\d/) || [])[0]
    let phone = null, phoneNote = ''

    if (phoneRaw) {
      let d = phoneRaw.replace(/[^\d+]/g, '')
      if (d.startsWith('+')) phone = d
      else if (d.startsWith('00')) phone = '+' + d.slice(2)
      else if (d.startsWith('0')) phone = country + d.slice(1)        // local trunk prefix
      else phone = country + d
      if (phone.replace(/\D/g, '').length < 8) { phoneNote = 'too short'; phone = null }
    }

    const emailOk = email && /^[^@]+@[^@.]+\.[a-z]{2,}$/i.test(email)
    if (emailOk && phone) good++
    rows.push(row(
      esc(line.slice(0, 40)),
      email ? (emailOk ? code(email.toLowerCase()) : tag(email + ' invalid', 'warn')) : tag('none', 'warn'),
      phone ? code(phone) : tag(phoneRaw ? phoneRaw + ' ' + phoneNote : 'none', 'warn')
    ))
  }

  return {
    stat: `${good}/${lines.length} fully clean`,
    html:
      `<p class="hint">Local numbers starting <code>0</code> are expanded with <code>${esc(country)}</code>. Change that in the second box.</p>` +
      table([row('<b>input</b>', '<b>email</b>', '<b>phone (E.164)</b>')].concat(rows)),
  }
}

// ─── 5. Duplicate Finder ─────────────────────────────────────────────────────
// Dice coefficient on bigrams — forgiving about typos and word order, and cheap.

function bigrams(s) {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b)
  if (!A.size || !B.size) return a === b ? 1 : 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

function findDuplicates([listA, listB]) {
  const a = listA.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const b = (listB || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const against = b.length ? b : a
  const selfMode = !b.length

  const hits = []
  for (let i = 0; i < a.length; i++) {
    for (let j = selfMode ? i + 1 : 0; j < against.length; j++) {
      const score = similarity(a[i], against[j])
      if (score >= 0.6) hits.push({ left: a[i], right: against[j], score })
    }
  }
  hits.sort((x, y) => y.score - x.score)

  return {
    stat: `${hits.length} likely duplicate${hits.length === 1 ? '' : 's'}`,
    html:
      `<p class="hint">${selfMode
        ? 'Comparing the list against itself. Paste a second list to compare two lists instead.'
        : 'Comparing list A against list B.'} Showing pairs scoring 0.6 or higher.</p>` +
      (hits.length
        ? table([row('<b>A</b>', '<b>B</b>', '<b>score</b>')].concat(
            hits.slice(0, 60).map((h) =>
              row(esc(h.left), esc(h.right), tag(h.score.toFixed(2), h.score > 0.85 ? 'good' : '')))))
        : `<p class="hint">No likely duplicates found.</p>`),
  }
}

// ─── 6. Template Variable Checker ────────────────────────────────────────────

function checkTemplate([tpl, dataRaw]) {
  let data
  try { data = JSON.parse(dataRaw || '{}') } catch (e) { throw new Error('Data must be valid JSON: ' + e.message) }

  const found = [...tpl.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1])
  const uniq = [...new Set(found)]
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data)

  const rows = uniq.map((v) => {
    const val = get(v)
    const missing = val === undefined
    const empty = val === '' || val === null
    return row(
      code('{{' + v + '}}'),
      missing ? tag('MISSING', 'warn') : empty ? tag('empty', 'warn') : tag('ok', 'good'),
      missing ? '' : esc(String(val).slice(0, 60))
    )
  })

  const missing = uniq.filter((v) => get(v) === undefined)
  const rendered = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, v) => {
    const val = get(v)
    return val === undefined ? `⟪${v}?⟫` : String(val)
  })

  const unused = Object.keys(data).filter((k) => !uniq.some((v) => v.split('.')[0] === k))

  return {
    stat: missing.length ? `${missing.length} would break` : `all ${uniq.length} resolve`,
    html:
      (missing.length
        ? `<p class="hint warn">${missing.length} variable${missing.length > 1 ? 's' : ''} missing from your data — ${missing.map(code).join(', ')}</p>`
        : `<p class="hint">Every variable resolves.</p>`) +
      table([row('<b>variable</b>', '<b>status</b>', '<b>value</b>')].concat(rows)) +
      (unused.length ? `<p class="hint">Unused data fields: ${unused.map(code).join(', ')}</p>` : '') +
      `<p class="hint">Preview:</p><pre class="json">${esc(rendered)}</pre>`,
  }
}

// ─── registry ────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    id: 'payload', name: 'Webhook Inspector', tagline: 'Paste a webhook payload, get every field path and type.',
    inputs: [{ label: 'JSON payload', rows: 14, placeholder: '{ "event": "order.created", ... }' }],
    sample: ['{\n  "event": "order.created",\n  "id": 48213,\n  "customer": {\n    "name": "Marcus Bell",\n    "email": "marcus@northwind.co",\n    "vip": true\n  },\n  "items": [\n    { "sku": "AB-19", "qty": 2, "price": 45.5 }\n  ],\n  "note": null\n}'],
    run: inspectPayload,
  },
  {
    id: 'cron', name: 'Cron Translator', tagline: 'Turn a cron expression into plain English and real dates.',
    inputs: [{ label: 'Cron expression', rows: 1, placeholder: '0 8 * * 1-5' }],
    sample: ['0 8 * * 1-5'],
    run: translateCron,
  },
  {
    id: 'csv', name: 'CSV → Clean JSON', tagline: 'Fix headers, detect types, flag broken rows.',
    inputs: [{ label: 'CSV', rows: 14, placeholder: 'Name, Email Address, Signed Up\n...' }],
    sample: ['First Name,Email Address,Signed Up,Active,Score\nMarcus Bell,MARCUS@northwind.co,2026-03-14,yes,91\nDana Okafor,dana@northwind.co,2026-04-02,no,76.5\nSam Ito,sam@acme.io,2026-04-11,yes,'],
    run: csvToJson,
  },
  {
    id: 'contacts', name: 'Contact Normalizer', tagline: 'Messy contact list in, E.164 phones and clean emails out.',
    inputs: [
      { label: 'Contacts (one per line)', rows: 11, placeholder: 'Marcus Bell marcus@northwind.co 0803 123 4567' },
      { label: 'Default country code', rows: 1, placeholder: '+234' },
    ],
    sample: ['Marcus Bell  marcus@NORTHWIND.co  0803 123 4567\nDana Okafor | dana@northwind.co | +234 701 555 0199\nSam Ito  sam(at)acme.io  08012345\nJo Adeyemi  jo@acme.io  (704) 935-5786', '+234'],
    run: normalizeContacts,
  },
  {
    id: 'dupes', name: 'Duplicate Finder', tagline: 'Fuzzy-match duplicates within a list, or across two lists.',
    inputs: [
      { label: 'List A (one per line)', rows: 11, placeholder: 'Acme Corporation' },
      { label: 'List B (optional)', rows: 11, placeholder: 'leave empty to find duplicates inside list A' },
    ],
    sample: ['Acme Corporation\nACME Corp.\nNorthwind Logistics Ltd\nnorthwind logistics limited\nMeridian CRM\nZenith Partners', ''],
    run: findDuplicates,
  },
  {
    id: 'template', name: 'Template Checker', tagline: 'See which {{variables}} would break before you send 500 emails.',
    inputs: [
      { label: 'Template', rows: 9, placeholder: 'Hi {{first_name}}, ...' },
      { label: 'Data (JSON)', rows: 9, placeholder: '{ "first_name": "Marcus" }' },
    ],
    sample: ['Hi {{first_name}},\n\nThanks for signing up to {{product.name}} on {{signup_date}}.\nYour account manager is {{manager}}.\n\n— {{sender}}', '{\n  "first_name": "Marcus",\n  "product": { "name": "Meridian CRM" },\n  "signup_date": "",\n  "sender": "Ayomide",\n  "plan": "Growth"\n}'],
    run: checkTemplate,
  },
]

if (typeof module !== 'undefined' && module.exports) module.exports = { TOOLS }
if (typeof window !== 'undefined') window.OPS_TOOLS = TOOLS
