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

function parseScheduleText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const rows = []
  let currentDay = null

  lines.forEach((line) => {
    if (line.endsWith(':')) {
      const header = line.slice(0, -1).trim()
      const dayName = header.replace(/^Turni\s+/i, '').trim()
      currentDay = dayName || null
      return
    }

    if (!currentDay) return

    const lower = line.toLowerCase()
    if (lower.indexOf('riposo') !== -1) {
      const parts = line.split(/\s+/)
      const person = parts[0]
      if (!person) return
      rows.push({
        day: currentDay,
        person,
        rest: true,
        intervals: [],
        raw: 'Riposo',
      })
      return
    }

    const firstSpace = line.indexOf(' ')
    if (firstSpace === -1) return

    const person = line.slice(0, firstSpace).trim()
    let restText = line.slice(firstSpace + 1).trim()

    restText = restText.replace(/pausa/gi, '').replace(/\s+/g, ' ')

    const intervalRegex = /(\d{1,2}(?::\d{1,2})?)\s*\/\s*(\d{1,2}(?::\d{1,2})?)/g
    const intervals = []
    let match

    while ((match = intervalRegex.exec(restText)) !== null) {
      const start = normalizeTime(match[1])
      const end = normalizeTime(match[2])
      if (start && end) {
        intervals.push({ start, end })
      }
    }

    rows.push({
      day: currentDay,
      person,
      rest: false,
      intervals,
      raw: restText,
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

  return rows
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

  const people = Array.from(new Set(rows.map((row) => row.person))).sort(
    (a, b) => a.localeCompare(b),
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
