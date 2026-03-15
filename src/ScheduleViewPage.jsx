import React, { useEffect, useRef, useState } from 'react'
import { loadScheduleIndexedDB, saveScheduleIndexedDB } from './storage'

const DAY_ORDER = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
]

const MAIN_PERSON = 'Simo'

const PERSON_ORDER = [
  'Simo',
  'Viola',
  'Nico',
  'Maria',
  'Ele',
  'Isma',
  'Katerina',
  'Daniela',
]

function normalizeTime(raw) {
  const value = raw.trim()
  if (!value) return ''

  if (value.indexOf(':') !== -1) {
    const parts = value.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1] || '0', 10)
    if (Number.isNaN(h) || Number.isNaN(m)) return ''
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    return hh + ':' + mm
  }

  const h = parseInt(value, 10)
  if (Number.isNaN(h)) return ''
  const hh = String(h).padStart(2, '0')
  return hh + ':00'
}

function normalizePersonName(raw) {
  const value = (raw || '').trim()
  if (!value) return value

  const lower = value.toLowerCase()
  if (lower === 'dani') return 'Daniela'
  if (lower === 'kate') return 'Katerina'

  return value
}

function parseScheduleText(text) {
  // 1) Normalizza il testo: spezza sui nomi dei giorni anche se sono in mezzo alla frase
  const dayNamesPattern = DAY_ORDER.join('|')
  const daySplitterRegex = new RegExp(`\\b(${dayNamesPattern})\\s*[:;]`, 'gi')

  const normalizedText = text.replace(daySplitterRegex, '\n$1:\n')

  const baseLines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const rows = []
  const debug = {
    timestamp: new Date().toISOString(),
    rawText: text,
    normalizedText,
    lines: baseLines.map((line, index) => ({ index, text: line })),
    steps: [],
    rowsByDayAndPerson: {},
  }

  // Regex per rilevare righe con più nomi (formato WhatsApp a riga unica)
  const multiNameRegex = /(?:^|[\s,])([A-ZÀ-ÖØ-Ý][a-zÀ-ÖØ-öø-ÿ]*)\b/g

  const hasMultipleNames = (body) => {
    if (!body) return false
    let count = 0
    let match
    while ((match = multiNameRegex.exec(body)) !== null) {
      count += 1
      if (count > 1) {
        multiNameRegex.lastIndex = 0
        return true
      }
    }
    multiNameRegex.lastIndex = 0
    return false
  }

  const isSimpleRestLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    // Es: "Kate R", "Simo R" ecc.
    return /^[A-ZÀ-ÖØ-Ý][a-zÀ-ÖØ-öø-ÿ]*\s+R\b/i.test(trimmed)
  }

  const ensureDayPersonBucket = (day, person) => {
    if (!day || !person) return
    if (!debug.rowsByDayAndPerson[day]) debug.rowsByDayAndPerson[day] = {}
    if (!debug.rowsByDayAndPerson[day][person]) {
      debug.rowsByDayAndPerson[day][person] = {
        rest: false,
        intervals: [],
        raw: '',
      }
    }
    return debug.rowsByDayAndPerson[day][person]
  }

  const splitDayBodyToPersonLines = (body) => {
    const result = []
    if (!body || !body.trim()) return result

    const nameRegex = /(?:^|[\s,])([A-ZÀ-ÖØ-Ý][a-zÀ-ÖØ-öø-ÿ]*)\b/g
    let lastStart = null
    let match

    while ((match = nameRegex.exec(body)) !== null) {
      const fullMatch = match[0]
      const nameStart = match.index + (fullMatch.startsWith(' ') || fullMatch.startsWith(',') ? 1 : 0)

      if (lastStart !== null) {
        const segment = body.slice(lastStart, nameStart).trim()
        if (segment) result.push(segment)
      }
      lastStart = nameStart
    }

    if (lastStart !== null) {
      const tail = body.slice(lastStart).trim()
      if (tail) result.push(tail)
    }

    return result
  }

  // intestazione giorno con due forme:
  // "Lunedì:" oppure solo "Lunedì"
  const dayHeaderRegex = new RegExp(
    `^(${dayNamesPattern})\\s*(?::\\s*(.*))?$`,
    'i',
  )

  const parsePersonLine = (day, line, originalIndex) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const firstSpace = trimmed.indexOf(' ')
    if (firstSpace === -1) {
      debug.steps.push({
        type: 'skipLineNoSpace',
        day,
        lineIndex: originalIndex,
        lineText: trimmed,
      })
      return
    }

    const rawPerson = trimmed.slice(0, firstSpace).trim()
    const person = normalizePersonName(rawPerson)
    let restText = trimmed.slice(firstSpace + 1).trim()

    if (!person || !restText) {
      debug.steps.push({
        type: 'skipLineEmptyParts',
        day,
        lineIndex: originalIndex,
        lineText: trimmed,
        person,
        rawPerson,
        restText,
      })
      return
    }

    const restTextLower = restText.toLowerCase()
    const isRestWord = restTextLower.indexOf('riposo') !== -1
    const isRestLetter = /^r\b/.test(restTextLower) && !/\d/.test(restText)

    if (isRestWord || isRestLetter) {
      const rawValue = isRestWord ? 'Riposo' : restText
      rows.push({
        day,
        person,
        rest: true,
        intervals: [],
        raw: rawValue,
      })
      const bucket = ensureDayPersonBucket(day, person)
      if (bucket) {
        bucket.rest = true
        bucket.intervals = []
        bucket.raw = rawValue
      }
      debug.steps.push({
        type: 'restRow',
        day,
        lineIndex: originalIndex,
        lineText: trimmed,
        person,
        rawPerson,
        reason: isRestWord ? 'riposoWord' : 'rLetter',
        rawRestText: restText,
      })
      return
    }

    const originalRestText = restText

    // normalizza testo: rimuovi "pausa", spazi extra e converte 7.30 / 7,30 in 7:30
    restText = restText
      .replace(/pausa/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/(\d{1,2})[.,](\d{1,2})/g, '$1:$2')

    const intervalRegex = /(\d{1,2}(?::\d{1,2})?)\s*\/\s*(\d{1,2}(?::\d{1,2})?)/g
    const intervals = []
    const intervalsRaw = []
    let match

    while ((match = intervalRegex.exec(restText)) !== null) {
      const start = normalizeTime(match[1])
      const end = normalizeTime(match[2])
      if (start && end) {
        intervals.push({ start, end })
        intervalsRaw.push({ startRaw: match[1], endRaw: match[2] })
      }
    }

    rows.push({
      day,
      person,
      rest: false,
      intervals,
      raw: restText,
    })

    const bucket = ensureDayPersonBucket(day, person)
    if (bucket) {
      bucket.rest = false
      bucket.intervals = intervals.slice()
      bucket.raw = restText
    }

    debug.steps.push({
      type: 'row',
      day,
      lineIndex: originalIndex,
      lineText: trimmed,
      person,
      rawPerson,
      rest: false,
      originalRestText,
      normalizedRestText: restText,
      intervalsRaw,
      intervals: intervals.slice(),
    })
  }

  let currentDay = null

  baseLines.forEach((line, index) => {
    const headerMatch = dayHeaderRegex.exec(line)
    dayHeaderRegex.lastIndex = 0

    if (headerMatch) {
      const rawDay = headerMatch[1].trim()
      const bodyPart = (headerMatch[2] || '').trim()

      const parsedDay =
        DAY_ORDER.find((d) => d.toLowerCase() === rawDay.toLowerCase()) ||
        rawDay

      currentDay = parsedDay
      debug.steps.push({
        type: 'dayHeader',
        lineIndex: index,
        lineText: line,
        parsedDay: currentDay,
      })

      if (bodyPart) {
        if (isSimpleRestLine(bodyPart) || !hasMultipleNames(bodyPart)) {
          // Una sola persona in riga (o formato "Nome R"): parsala diretta
          debug.steps.push({
            type: 'singlePersonFromHeaderBody',
            fromLineIndex: index,
            day: currentDay,
            personLine: bodyPart,
          })
          parsePersonLine(currentDay, bodyPart, index)
        } else {
          const personLines = splitDayBodyToPersonLines(bodyPart)
          personLines.forEach((personLine, idx) => {
            debug.steps.push({
              type: 'splitPersonLine',
              fromLineIndex: index,
              day: currentDay,
              personLineIndex: idx,
              personLine,
            })
            parsePersonLine(currentDay, personLine, index)
          })
        }
      }
      return
    }

    if (!currentDay) {
      // riga introduttiva/testo libero prima dell'inizio dei turni
      debug.steps.push({
        type: 'introLine',
        lineIndex: index,
        lineText: line,
      })
      return
    }

    // Se la riga è del tipo "Nome R" trattala come una sola persona
    if (isSimpleRestLine(line)) {
      debug.steps.push({
        type: 'singlePersonRestLine',
        fromLineIndex: index,
        day: currentDay,
        personLine: line,
      })
      parsePersonLine(currentDay, line, index)
      return
    }

    // Se non ci sono più nomi, è una sola persona su questa riga
    if (!hasMultipleNames(line)) {
      debug.steps.push({
        type: 'singlePersonLine',
        fromLineIndex: index,
        day: currentDay,
        personLine: line,
      })
      parsePersonLine(currentDay, line, index)
      return
    }

    const personLines = splitDayBodyToPersonLines(line)
    if (!personLines.length) return

    personLines.forEach((personLine, idx) => {
      debug.steps.push({
        type: 'splitPersonLine',
        fromLineIndex: index,
        day: currentDay,
        personLineIndex: idx,
        personLine,
      })
      parsePersonLine(currentDay, personLine, index)
    })
  })

  const dayIndex = (day) => {
    const index = DAY_ORDER.indexOf(day)
    if (index === -1) return 99
    return index
  }

  rows.sort((a, b) => {
    const da = dayIndex(a.day)
    const db = dayIndex(b.day)
    if (da !== db) return da - db
    if (a.person < b.person) return -1
    if (a.person > b.person) return 1
    return 0
  })

  const result = rows

  try {
    const payload = {
      ...debug,
      resultRows: result,
      resultRowCount: result.length,
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          'turni-simo:last-parse-log',
          JSON.stringify(payload),
        )
      } catch {
        // ignore localStorage errors
      }

      try {
        // variabile globale per copia/incolla veloce da console
        window.__TURNI_LAST_PARSE_LOG__ = payload
      } catch {
        // ignore
      }
    }

    if (typeof console !== 'undefined' && console.log) {
      console.log('[Turni Simo] parseScheduleText debug log', payload)
    }
  } catch {
    // qualsiasi errore nel logging non deve rompere il parsing
  }

  return result
}

const SCHEDULE_STORAGE_KEY = 'turni-simo:schedule-text'

function loadScheduleLocal() {
  try {
    const raw = window.localStorage.getItem(SCHEDULE_STORAGE_KEY)
    if (!raw) return { text: '', rows: [], baseDate: '' }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { text: '', rows: [], baseDate: '' }
    }
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      baseDate:
        typeof parsed.baseDate === 'string' ? parsed.baseDate : '',
    }
  } catch {
    return { text: '', rows: [], baseDate: '' }
  }
}

function saveScheduleLocal(state) {
  try {
    window.localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function ScheduleViewPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])
  const [baseDate, setBaseDate] = useState('')
  const [onlyWithMe, setOnlyWithMe] = useState(false)

  const daysHeaderRef = useRef(null)
  const daysBodyRef = useRef(null)

  function handleApply() {
    const parsed = parseScheduleText(text)
    setRows(parsed)
    setIsModalOpen(false)
    const state = { text, rows: parsed, baseDate }
    saveScheduleLocal(state)
    saveScheduleIndexedDB(state)
  }

  useEffect(() => {
    const bodyEl = daysBodyRef.current
    const headerEl = daysHeaderRef.current
    if (!bodyEl || !headerEl) return undefined

    let rafId = 0
    const onBodyScroll = (event) => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        headerEl.scrollLeft = event.target.scrollLeft
        rafId = 0
      })
    }

    bodyEl.addEventListener('scroll', onBodyScroll, { passive: true })

    return () => {
      bodyEl.removeEventListener('scroll', onBodyScroll)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [rows.length])

  useEffect(() => {
    // carica stato salvato (ultimo orario incollato)
    const local = loadScheduleLocal()
    if (local.text) {
      setText(local.text)
      setRows(parseScheduleText(local.text))
      if (local.baseDate) setBaseDate(local.baseDate)
    }

    let cancelled = false
    loadScheduleIndexedDB().then((state) => {
      if (cancelled) return
      if (state && state.text) {
        setText(state.text)
        setRows(parseScheduleText(state.text))
        if (state.baseDate) setBaseDate(state.baseDate)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const activeDays = DAY_ORDER.filter((day) =>
    rows.some((row) => row.day === day),
  )

  const getPersonOrderIndex = (name) => {
    if (!name) return -1
    const lower = name.toLowerCase()
    return PERSON_ORDER.findIndex((p) => p.toLowerCase() === lower)
  }

  const people = Array.from(new Set(rows.map((row) => row.person))).sort(
    (a, b) => {
      const ia = getPersonOrderIndex(a)
      const ib = getPersonOrderIndex(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    },
  )

  const mainPersonByDay = rows.reduce((acc, row) => {
    if (row.person !== MAIN_PERSON || row.rest) return acc
    if (!acc[row.day]) acc[row.day] = []
    acc[row.day].push(...row.intervals)
    return acc
  }, {})

  function getCellRows(person, day) {
    return rows.filter((row) => row.person === person && row.day === day)
  }

  function getMinutes(interval) {
    if (!interval || !interval.start || !interval.end) return 0
    const [inH, inM] = interval.start.split(':').map((v) => parseInt(v, 10))
    const [outH, outM] = interval.end.split(':').map((v) => parseInt(v, 10))
    if (
      Number.isNaN(inH) ||
      Number.isNaN(inM) ||
      Number.isNaN(outH) ||
      Number.isNaN(outM)
    ) {
      return 0
    }
    let startMinutes = inH * 60 + inM
    let endMinutes = outH * 60 + outM
    if (endMinutes < startMinutes) endMinutes += 24 * 60
    const diff = endMinutes - startMinutes
    return diff > 0 ? diff : 0
  }

  function toRange(interval) {
    if (!interval || !interval.start || !interval.end) return null
    const [inH, inM] = interval.start.split(':').map((v) => parseInt(v, 10))
    const [outH, outM] = interval.end.split(':').map((v) => parseInt(v, 10))
    if (
      Number.isNaN(inH) ||
      Number.isNaN(inM) ||
      Number.isNaN(outH) ||
      Number.isNaN(outM)
    ) {
      return null
    }
    let start = inH * 60 + inM
    let end = outH * 60 + outM
    if (end <= start) end += 24 * 60
    return { start, end }
  }

  function hasOverlapWithMainPerson(day, cellRows) {
    const mainIntervals = mainPersonByDay[day] || []
    if (!onlyWithMe || !mainIntervals.length || !cellRows.length) return false

    const mainRanges = mainIntervals
      .map((i) => toRange(i))
      .filter(Boolean)
    if (!mainRanges.length) return false

    for (const row of cellRows) {
      if (row.rest || !row.intervals || !row.intervals.length) continue
      for (const interval of row.intervals) {
        const r = toRange(interval)
        if (!r) continue
        for (const mr of mainRanges) {
          const start = Math.max(r.start, mr.start)
          const end = Math.min(r.end, mr.end)
          if (end - start > 0) {
            return true
          }
        }
      }
    }
    return false
  }

  function hasSomeoneOverlappingMain(day) {
    const mainIntervals = mainPersonByDay[day] || []
    if (!onlyWithMe || !mainIntervals.length) return false

    const mainRanges = mainIntervals
      .map((i) => toRange(i))
      .filter(Boolean)
    if (!mainRanges.length) return false

    const dayRows = rows.filter(
      (row) => row.day === day && row.person !== MAIN_PERSON,
    )

    for (const row of dayRows) {
      if (row.rest || !row.intervals || !row.intervals.length) continue
      for (const interval of row.intervals) {
        const r = toRange(interval)
        if (!r) continue
        for (const mr of mainRanges) {
          const start = Math.max(r.start, mr.start)
          const end = Math.min(r.end, mr.end)
          if (end - start > 0) {
            return true
          }
        }
      }
    }
    return false
  }

  function formatTotalHours(minutes) {
    if (!minutes) return '0h'
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (!mins) return `${hours}h`
    return `${hours}h ${String(mins).padStart(2, '0')}m`
  }

  function getDateForDay(day) {
    if (!baseDate) return null
    const monday = new Date(baseDate)
    if (Number.isNaN(monday.getTime())) return null

    const dayIndex = DAY_ORDER.indexOf(day)
    if (dayIndex === -1) return null

    const d = new Date(monday)
    d.setDate(d.getDate() + dayIndex)
    return d
  }

  return (
    <div className="page schedule-page">
      <div className="page-header-row">
        <h2 className="page-title">View turni</h2>
        <button
          type="button"
          className="icon-button-ghost"
          onClick={() => setIsModalOpen(true)}
        >
          Incolla testo
        </button>
      </div>

      <section className="card list-card">
        <h3 className="section-title">Tabella turni</h3>
        {rows.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '0.4rem',
              marginBottom: '0.35rem',
            }}
          >
            <label
              style={{
                fontSize: '0.75rem',
                color: 'var(--muted-text)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <input
                type="checkbox"
                checked={onlyWithMe}
                onChange={(e) => setOnlyWithMe(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              Solo in turno con {MAIN_PERSON}
            </label>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="empty-text">
            Nessun turno da mostrare. Incolla il testo dei turni per
            vederli qui.
          </p>
        ) : (
          <div
            className="table-wrapper"
            style={{ overflowX: 'hidden' }}
          >
            <div
              style={{
                display: 'flex',
                height: '48px',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <div
                style={{
                  flex: '0 0 auto',
                  minWidth: '120px',
                  width: '120px',
                  maxWidth: '120px',
                }}
              >
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'var(--muted-text)',
                    padding: '0 10px 0 6px',
                    height: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    lineHeight: 1,
                  }}
                >
                  Collaboratore
                </div>
              </div>
              <div
                ref={daysHeaderRef}
                style={{
                  flex: '1 1 auto',
                  overflowX: 'hidden',
                  overflowY: 'hidden',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  pointerEvents: 'none',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'separate',
                    borderSpacing: '0 0',
                    minWidth: '640px',
                  }}
                >
                  <thead>
                    <tr style={{ height: '48px' }}>
                      {activeDays.map((day) => {
                        const dateForDay = getDateForDay(day)
                        const dayNumber = dateForDay
                          ? String(dateForDay.getDate()).padStart(2, '0')
                          : ''
                        return (
                        <th
                          key={day}
                          style={{
                            textAlign: 'left',
                            fontSize: '0.8rem',
                            color: 'var(--muted-text)',
                            padding: '0 10px',
                            minWidth: '120px',
                            height: '48px',
                            verticalAlign: 'middle',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              height: '48px',
                              gap: '6px',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{day[0]}</span>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--muted-text)',
                              }}
                            >
                              {dayNumber}
                            </span>
                          </div>
                        </th>
                        )
                      })}
                      <th
                        style={{
                          textAlign: 'left',
                          fontSize: '0.8rem',
                          color: 'var(--muted-text)',
                          padding: '0 10px',
                          minWidth: '120px',
                          height: '48px',
                          verticalAlign: 'middle',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: '48px',
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>Totale</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex' }}>
              <div
                style={{
                  flex: '0 0 auto',
                  minWidth: '120px',
                  width: '120px',
                  maxWidth: '120px',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'separate',
                    borderSpacing: '0 8px',
                    width: '100%',
                    tableLayout: 'fixed',
                  }}
                >
                  <tbody>
                    {people.map((person) => (
                      <tr key={`left-${person}`}>
                        <td
                          style={{
                            background: 'var(--chip-bg)',
                            borderRadius: '12px',
                            padding: '8px 6px 8px 6px',
                            verticalAlign: 'top',
                            height: '72px',
                            maxHeight: '72px',
                            overflow: 'hidden',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'center',
                              gap: '4px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {person}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                ref={daysBodyRef}
                style={{
                  flex: '1 1 auto',
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  willChange: 'scroll-position',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'separate',
                    borderSpacing: '0 8px',
                    minWidth: '640px',
                  }}
                >
                  <tbody>
                    {people.map((person) => {
                      let totalMinutes = 0
                      return (
                        <tr key={`right-${person}`} style={{ height: '72px' }}>
                          {activeDays.map((day) => {
                            const cellRows = getCellRows(person, day)
                            const isRest =
                              cellRows.length > 0 &&
                              cellRows.every((r) => r.rest)
                            const cellMinutes = cellRows.reduce(
                              (acc, row) =>
                                acc +
                                row.intervals.reduce(
                                  (sum, interval) =>
                                    sum + getMinutes(interval),
                                  0,
                                ),
                              0,
                            )
                            totalMinutes += cellMinutes

                            const highlight =
                              (person !== MAIN_PERSON &&
                                hasOverlapWithMainPerson(day, cellRows)) ||
                              (person === MAIN_PERSON &&
                                hasSomeoneOverlappingMain(day))

                            return (
                              <td
                                key={`${person}-${day}`}
                                style={{
                                  background: highlight
                                    ? 'rgba(56,189,248,0.35)'
                                    : 'var(--chip-bg)',
                                  borderRadius: '12px',
                                  padding: '8px 10px',
                                  verticalAlign: 'top',
                                  minWidth: '120px',
                                  height: '72px',
                                  maxHeight: '72px',
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    height: '100%',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  {cellRows.length === 0 && (
                                    <span
                                      style={{
                                        color: 'var(--muted-text)',
                                      }}
                                    >
                                      —
                                    </span>
                                  )}
                                  {cellRows.map((row, idx) => {
                                    if (row.rest) {
                                      return (
                                        <span
                                          key={idx}
                                          style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--muted-text)',
                                          }}
                                        >
                                          Riposo
                                        </span>
                                      )
                                    }

                                    if (row.intervals.length > 0) {
                                      return (
                                        <span key={idx}>
                                          {row.intervals
                                            .map(
                                              (interval) =>
                                                `${interval.start} - ${interval.end}`,
                                            )
                                            .join('   ')}
                                        </span>
                                      )
                                    }

                                    return <span key={idx}>{row.raw}</span>
                                  })}
                                </div>
                              </td>
                            )
                          })}
                          <td
                            style={{
                              background: 'var(--chip-bg)',
                              borderRadius: '12px',
                              padding: '8px 10px',
                              verticalAlign: 'top',
                              minWidth: '120px',
                              height: '72px',
                              maxHeight: '72px',
                              overflow: 'hidden',
                              fontSize: '0.85rem',
                              fontWeight: 700,
                            }}
                          >
                            {formatTotalHours(totalMinutes)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="card modal-card">
            <h3 className="section-title">Incolla testo turni</h3>
            <div className="field-group">
              <label className="field-label" htmlFor="baseDate">
                Lunedì della settimana
              </label>
              <input
                id="baseDate"
                type="date"
                className="field-input"
                value={baseDate}
                onChange={(event) => setBaseDate(event.target.value)}
              />
            </div>
            <textarea
              className="field-textarea"
              rows={10}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Incolla qui il testo con i turni..."
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setText('')}
              >
                Svuota
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsModalOpen(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleApply}
                disabled={!text.trim()}
              >
                Applica
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
