import React, { useEffect, useMemo, useState } from 'react'
import {
  loadTimbratureIndexedDB,
  saveTimbratureIndexedDB,
} from './storage'

const STORAGE_KEY = 'turni-simo:timbrature'

function getTodayLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function loadTimbrature() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function saveTimbrature(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

function getMinutesFromTimes(inTime, outTime) {
  if (!inTime || !outTime) return 0
  const [inH, inM] = inTime.split(':').map((v) => parseInt(v, 10))
  const [outH, outM] = outTime.split(':').map((v) => parseInt(v, 10))

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

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60
  }

  const diff = endMinutes - startMinutes
  return diff > 0 ? diff : 0
}

function formatHoursFromMinutes(minutes) {
  if (!minutes) return '0h'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (!mins) return `${hours}h`
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return monthKey
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
  })
}

function formatDateLabel(dateKey) {
  const date = new Date(dateKey)
  if (Number.isNaN(date.getTime())) return dateKey
  const formatted = date.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function getMonthDateKeys(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return []
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthStr = String(month).padStart(2, '0')
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return `${year}-${monthStr}-${day}`
  })
}

function getDurationHours(inTime, outTime) {
  if (!inTime || !outTime) return ''

  const [inH, inM] = inTime.split(':').map((v) => parseInt(v, 10))
  const [outH, outM] = outTime.split(':').map((v) => parseInt(v, 10))

  if (
    Number.isNaN(inH) ||
    Number.isNaN(inM) ||
    Number.isNaN(outH) ||
    Number.isNaN(outM)
  ) {
    return ''
  }

  let startMinutes = inH * 60 + inM
  let endMinutes = outH * 60 + outM

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60
  }

  const diff = endMinutes - startMinutes
  if (diff <= 0) return ''

  const hours = Math.floor(diff / 60)
  const minutes = diff % 60

  const hoursText = String(hours)
  const minutesText = String(minutes).padStart(2, '0')

  return hoursText + ':' + minutesText
}

export function TimbraturePage() {
  const [entries, setEntries] = useState([])
  const [date, setDate] = useState(() => getTodayLocalDate())
  const [inTime, setInTime] = useState('')
  const [outTime, setOutTime] = useState('')

  const entriesByMonth = useMemo(() => {
    const map = {}
    for (const entry of entries) {
      if (!entry.date) continue
      const monthKey = entry.date.slice(0, 7)
      if (!map[monthKey]) map[monthKey] = {}
      map[monthKey][entry.date] = entry
    }
    return map
  }, [entries])

  const availableMonths = useMemo(() => {
    const keys = Object.keys(entriesByMonth)
    if (!keys.length) return []
    return keys.sort().reverse()
  }, [entriesByMonth])

  const todayMonthKey = getTodayLocalDate().slice(0, 7)

  const initialMonth =
    availableMonths.includes(todayMonthKey) && todayMonthKey
      ? todayMonthKey
      : availableMonths[0] || todayMonthKey

  const [selectedMonth, setSelectedMonth] = useState(initialMonth)

  useEffect(() => {
    setEntries(loadTimbrature())

    let cancelled = false
    loadTimbratureIndexedDB().then((list) => {
      if (cancelled) return
      if (Array.isArray(list) && list.length) {
        setEntries(list)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    saveTimbrature(entries)
     if (entries && entries.length) {
       // salva anche su IndexedDB, senza bloccare UI
       saveTimbratureIndexedDB(entries)
     }
  }, [entries])

  function handleAdd(e) {
    e.preventDefault()
    if (!date || !inTime || !outTime) return

    const newEntry = {
      id: Date.now().toString(),
      date,
      inTime,
      outTime,
    }

    setEntries((prev) => [newEntry, ...prev])
    setDate(getTodayLocalDate())
    setInTime('')
    setOutTime('')
  }

  function handleDelete(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const monthDateKeys = useMemo(
    () => (selectedMonth ? getMonthDateKeys(selectedMonth) : []),
    [selectedMonth],
  )

  const monthEntries = selectedMonth ? entriesByMonth[selectedMonth] || {} : {}

  const monthWeeks = useMemo(() => {
    if (!monthDateKeys.length) return []
    const weeks = []
    let current = []
    monthDateKeys.forEach((dateKey) => {
      current.push(dateKey)
      const day = new Date(dateKey).getDay()
      if (day === 0) {
        weeks.push(current)
        current = []
      }
    })
    if (current.length) weeks.push(current)
    return weeks
  }, [monthDateKeys])

  const monthTotalMinutes = useMemo(() => {
    return monthDateKeys.reduce((acc, dateKey) => {
      const row = monthEntries[dateKey]
      if (!row) return acc
      return acc + getMinutesFromTimes(row.inTime, row.outTime)
    }, 0)
  }, [monthDateKeys, monthEntries])

  return (
    <div className="page timbrature-page">
      <h2 className="page-title">Timbrature</h2>

      <form className="card timbrature-form" onSubmit={handleAdd}>
        <div className="field-group">
          <label className="field-label" htmlFor="date">
            Giorno
          </label>
          <input
            id="date"
            type="date"
            className="field-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="field-row">
          <div className="field-group">
            <label className="field-label" htmlFor="inTime">
              Entrata
            </label>
            <input
              id="inTime"
              type="time"
              className="field-input"
              value={inTime}
              onChange={(e) => setInTime(e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="outTime">
              Uscita
            </label>
            <input
              id="outTime"
              type="time"
              className="field-input"
              value={outTime}
              onChange={(e) => setOutTime(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className="primary-button">
          Salva timbratura
        </button>
      </form>

      <section className="card list-card">
        <h3 className="section-title">Riepilogo del mese</h3>
        {monthDateKeys.length === 0 ? (
          <p className="empty-text">Nessuna timbratura per questo mese.</p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                marginBottom: '8px',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--muted-text)',
                }}
              >
                Mese
              </span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '10px',
                  border: '1px solid var(--input-border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                }}
              >
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month)}
                  </option>
                ))}
              </select>
            </div>

            <div className="table-wrapper">
              <table
                style={{
                  borderCollapse: 'collapse',
                  fontSize: '0.8rem',
                  width: '100%',
                }}
              >
                <thead>
                  <tr
                    style={{
                      color: 'var(--muted-text)',
                      borderBottom: '1px solid rgba(55,65,81,0.7)',
                    }}
                  >
                    <th
                      style={{
                        padding: '6px',
                        textAlign: 'left',
                        fontWeight: 600,
                      }}
                    >
                      Data
                    </th>
                    <th
                      style={{
                        padding: '6px',
                        textAlign: 'left',
                        fontWeight: 600,
                      }}
                    >
                      Entrata
                    </th>
                    <th
                      style={{
                        padding: '6px',
                        textAlign: 'left',
                        fontWeight: 600,
                      }}
                    >
                      Uscita
                    </th>
                    <th
                      style={{
                        padding: '6px',
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      Ore
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monthWeeks.map((week, weekIndex) => {
                    const weekTotalMinutes = week.reduce((acc, dateKey) => {
                      const row = monthEntries[dateKey]
                      if (!row) return acc
                      return (
                        acc + getMinutesFromTimes(row.inTime, row.outTime)
                      )
                    }, 0)

                    return (
                      <React.Fragment key={`week-${weekIndex}`}>
                        <tr
                          style={{
                            background: 'rgba(148,163,184,0.12)',
                          }}
                        >
                          <td
                            style={{
                              padding: '6px',
                              fontWeight: 700,
                            }}
                            colSpan={3}
                          >
                            Settimana {weekIndex + 1}
                          </td>
                          <td
                            style={{
                              padding: '6px',
                              textAlign: 'right',
                              fontWeight: 700,
                            }}
                          >
                            {formatHoursFromMinutes(weekTotalMinutes)}
                          </td>
                        </tr>
                        {week.map((dateKey) => {
                          const row = monthEntries[dateKey]
                          const hasEntry = !!row
                          const durationMinutes = hasEntry
                            ? getMinutesFromTimes(row.inTime, row.outTime)
                            : 0
                          return (
                            <tr key={dateKey}>
                              <td style={{ padding: '6px' }}>
                                {formatDateLabel(dateKey)}
                              </td>
                              <td style={{ padding: '6px' }}>
                                {hasEntry ? row.inTime : ''}
                              </td>
                              <td style={{ padding: '6px' }}>
                                {hasEntry ? row.outTime : ''}
                              </td>
                              <td
                                style={{
                                  padding: '6px',
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              >
                                {hasEntry
                                  ? formatHoursFromMinutes(durationMinutes)
                                  : '0h'}
                              </td>
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div
              style={{
                marginTop: '8px',
                textAlign: 'right',
                fontWeight: 700,
                fontSize: '0.85rem',
              }}
            >
              Totale mese: {formatHoursFromMinutes(monthTotalMinutes)}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
