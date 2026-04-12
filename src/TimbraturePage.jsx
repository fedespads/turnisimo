import React, { useEffect, useMemo, useState } from 'react'
import {
  loadTimbratureIndexedDB,
  saveTimbratureIndexedDB,
  loadScheduleIndexedDB,
} from './storage'

const STORAGE_KEY = 'turni-simo:timbrature'
const BACKUP_KEY = 'turni-simo:timbrature:backup'
const MAIN_PERSON = 'Simo'
const DAY_ORDER = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
]

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
    let parsedMain = []
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          parsedMain = parsed
        }
      } catch {
        // ignora, proviamo dal backup
      }
    }

    if (parsedMain.length) return parsedMain

    const rawBackup = window.localStorage.getItem(BACKUP_KEY)
    if (rawBackup) {
      try {
        const parsedBackup = JSON.parse(rawBackup)
        if (Array.isArray(parsedBackup) && parsedBackup.length) {
          return parsedBackup
        }
      } catch {
        // ignore
      }
    }

    return []
  } catch {
    return []
  }
}

function saveTimbrature(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    if (Array.isArray(list) && list.length) {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify(list))
    }
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

function normalizeScheduleTime(raw) {
  if (!raw) return ''
  let value = String(raw).trim()
  if (!value) return ''

  // converte formati tipo 7.30 o 7,30 in 7:30
  value = value.replace(/(\d{1,2})[.,](\d{1,2})/g, '$1:$2')

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

export function TimbraturePage() {
  const [entries, setEntries] = useState([])
  const [date, setDate] = useState(() => getTodayLocalDate())
  const [inTime, setInTime] = useState('')
  const [outTime, setOutTime] = useState('')
  const [scheduleState, setScheduleState] = useState(null)
  const [showBackupPanel, setShowBackupPanel] = useState(false)

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
    let cancelled = false

    loadScheduleIndexedDB()
      .then((state) => {
        if (cancelled) return
        if (!state || !state.baseDate || !Array.isArray(state.rows)) {
          setScheduleState(null)
          return
        }
        setScheduleState({
          baseDate: state.baseDate,
          rows: state.rows,
        })
      })
      .catch(() => {
        setScheduleState(null)
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

  // Auto-compila le timbrature mancanti di Simo dalla settimana del piano orario
  useEffect(() => {
    if (!scheduleState || !scheduleState.baseDate || !scheduleState.rows) {
      return
    }

    const monday = new Date(scheduleState.baseDate)
    if (Number.isNaN(monday.getTime())) return

    const todayKey = getTodayLocalDate()

    const newEntries = []

    for (let offset = 0; offset < 7; offset += 1) {
      const d = new Date(monday)
      d.setDate(d.getDate() + offset)
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateKey = `${year}-${month}-${day}`

      // non creare timbrature future
      if (dateKey > todayKey) continue

      const already = entries.some((e) => e.date === dateKey)
      if (already) continue

      const jsDay = d.getDay() // 0 = domenica, 1 = lunedì ...
      const index = jsDay === 0 ? 6 : jsDay - 1
      const dayName = DAY_ORDER[index]

      const rowsForDay = scheduleState.rows.filter(
        (row) =>
          row.day === dayName && row.person === MAIN_PERSON && !row.rest,
      )
      if (!rowsForDay.length) continue

      const intervals = rowsForDay[0].intervals || []
      if (!intervals.length) continue

      const first = intervals[0]
      const start = normalizeScheduleTime(first.start)
      const end = normalizeScheduleTime(first.end)
      if (!start || !end) continue

      newEntries.push({
        id: `${dateKey}-${MAIN_PERSON}`,
        date: dateKey,
        inTime: start,
        outTime: end,
      })
    }

    if (newEntries.length) {
      setEntries((prev) => {
        const existingDates = new Set(prev.map((e) => e.date))
        const filteredNew = newEntries.filter((e) => !existingDates.has(e.date))
        if (!filteredNew.length) return prev
        return [...prev, ...filteredNew]
      })
    }
  }, [scheduleState, entries])

  // Quando cambio giorno, mostra sempre l'orario di Simo per quel giorno
  // o, se esiste già una timbratura salvata, quella salvata.
  useEffect(() => {
    if (!date) return

    const existing = entries.find((e) => e.date === date)
    if (existing) {
      setInTime(existing.inTime || '')
      setOutTime(existing.outTime || '')
      return
    }

    if (!scheduleState || !scheduleState.baseDate || !scheduleState.rows) {
      setInTime('')
      setOutTime('')
      return
    }

    const monday = new Date(scheduleState.baseDate)
    const current = new Date(date)
    if (Number.isNaN(monday.getTime()) || Number.isNaN(current.getTime())) {
      setInTime('')
      setOutTime('')
      return
    }

    const diffMs =
      current.setHours(0, 0, 0, 0) - monday.setHours(0, 0, 0, 0)
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    if (diffDays < 0 || diffDays > 6) {
      setInTime('')
      setOutTime('')
      return
    }

    const jsDay = current.getDay() // 0 = domenica, 1 = lunedì ...
    const index = jsDay === 0 ? 6 : jsDay - 1
    const dayName = DAY_ORDER[index]

    const rowsForDay = scheduleState.rows.filter(
      (row) => row.day === dayName && row.person === MAIN_PERSON && !row.rest,
    )
    if (!rowsForDay.length) {
      setInTime('')
      setOutTime('')
      return
    }

    const intervals = rowsForDay[0].intervals || []
    if (!intervals.length) {
      setInTime('')
      setOutTime('')
      return
    }

    const first = intervals[0]
    const start = normalizeScheduleTime(first.start)
    const end = normalizeScheduleTime(first.end)
    if (!start || !end) {
      setInTime('')
      setOutTime('')
      return
    }

    setInTime(start)
    setOutTime(end)
  }, [date, entries, scheduleState])

  function handleAdd(e) {
    e.preventDefault()
    if (!date || !inTime || !outTime) return

    setEntries((prev) => {
      const index = prev.findIndex((entry) => entry.date === date)
      if (index !== -1) {
        const updated = [...prev]
        updated[index] = {
          ...updated[index],
          inTime,
          outTime,
        }
        return updated
      }

      const newEntry = {
        id: Date.now().toString(),
        date,
        inTime,
        outTime,
      }

      return [newEntry, ...prev]
    })
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
    <div className="page timbrature-page timbrature-page-root">
      <div className="page-header-row timbrature-header-row">
        <h2 className="page-title timbrature-title">
          Timbrature
        </h2>
        <button
          type="button"
          className="icon-button-ghost timbrature-settings-button"
          onClick={() => setShowBackupPanel((v) => !v)}
        >
          ⚙
        </button>
      </div>

      {showBackupPanel && (
        <div className="card backup-panel-card">
          <h3 className="section-title backup-panel-title">Backup</h3>
          <div className="backup-actions-row">
            <button
              type="button"
              className="secondary-button backup-export-button"
              onClick={() => {
                try {
                  const payload = JSON.stringify(entries)
                  if (
                    navigator.clipboard &&
                    navigator.clipboard.writeText
                  ) {
                    navigator.clipboard
                      .writeText(payload)
                      .catch(() => {
                        window.prompt('Copia questo backup:', payload)
                      })
                  } else {
                    window.prompt('Copia questo backup:', payload)
                  }
                } catch {
                  // ignore
                }
              }}
            >
              Esporta backup
            </button>
            <button
              type="button"
              className="secondary-button backup-import-button"
              onClick={() => {
                const json = window.prompt(
                  'Incolla qui il backup timbrature (JSON):',
                )
                if (!json) return
                try {
                  const parsed = JSON.parse(json)
                  if (Array.isArray(parsed)) {
                    setEntries(parsed)
                  }
                } catch {
                  // ignore
                }
              }}
            >
              Importa backup
            </button>
          </div>
        </div>
      )}

      <form
        className="card timbrature-form timbrature-form-card"
        onSubmit={handleAdd}
      >
        <div className="field-group timbrature-date-group">
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

        <div className="field-row timbrature-time-row">
          <div className="field-group timbrature-time-group timbrature-time-group-in">
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
          <div className="field-group timbrature-time-group timbrature-time-group-out">
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

        <button
          type="submit"
          className="primary-button timbrature-submit-button"
        >
          Conferma timbratura
        </button>
      </form>

      <section className="card list-card timbrature-summary-section">
        <h3 className="section-title timbrature-summary-title">
          Riepilogo del mese
        </h3>
        {monthDateKeys.length === 0 ? (
          <p className="empty-text timbrature-empty-month-text">
            Nessuna timbratura per questo mese.
          </p>
        ) : (
          <>
            <div className="timbrature-month-header-row">
              <span className="timbrature-month-label">
                Mese
              </span>
              <select
                className="timbrature-month-select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month)}
                  </option>
                ))}
              </select>
            </div>

            <div className="table-wrapper timbrature-table-wrapper">
              <table className="timbrature-table">
                <thead className="timbrature-table-head">
                  <tr className="timbrature-header-row">
                    <th
                      className="timbrature-header-cell timbrature-header-date"
                    >
                      Data
                    </th>
                    <th
                      className="timbrature-header-cell timbrature-header-in"
                    >
                      Entrata
                    </th>
                    <th
                      className="timbrature-header-cell timbrature-header-out"
                    >
                      Uscita
                    </th>
                    <th
                      className="timbrature-header-cell timbrature-header-hours"
                    >
                      Ore
                    </th>
                  </tr>
                </thead>
                <tbody className="timbrature-table-body">
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
                        <tr className="timbrature-week-summary-row">
                          <td
                            className="timbrature-week-label-cell"
                            colSpan={3}
                          >
                            Settimana {weekIndex + 1}
                          </td>
                          <td className="timbrature-week-total-cell">
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
                            <tr
                              key={dateKey}
                              className="timbrature-day-row"
                            >
                              <td
                                className="timbrature-day-cell timbrature-day-date-cell"
                              >
                                {formatDateLabel(dateKey)}
                              </td>
                              <td
                                className="timbrature-day-cell timbrature-day-in-cell"
                              >
                                {hasEntry ? row.inTime : ''}
                              </td>
                              <td
                                className="timbrature-day-cell timbrature-day-out-cell"
                              >
                                {hasEntry ? row.outTime : ''}
                              </td>
                              <td
                                className="timbrature-day-cell timbrature-day-hours-cell"
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
            <div className="timbrature-month-total-row">
              Totale mese:{' '}
              <span className="timbrature-month-total-value">
                {formatHoursFromMinutes(monthTotalMinutes)}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
