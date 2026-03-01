const DB_NAME = 'turni-simo-db'
const DB_VERSION = 1
const TIMBRATURE_STORE = 'timbrature'
const SCHEDULE_STORE = 'schedule'

function openDB() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('indexedDB non disponibile'))
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(TIMBRATURE_STORE)) {
        db.createObjectStore(TIMBRATURE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error || new Error('Errore apertura IndexedDB'))
    }
  })
}

export async function saveTimbratureIndexedDB(list) {
  try {
    const db = await openDB()
    const tx = db.transaction(TIMBRATURE_STORE, 'readwrite')
    const store = tx.objectStore(TIMBRATURE_STORE)
    store.clear()
    for (const item of list) {
      store.put(item)
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // ignora errori IndexedDB
  }
}

export async function loadTimbratureIndexedDB() {
  try {
    const db = await openDB()
    const tx = db.transaction(TIMBRATURE_STORE, 'readonly')
    const store = tx.objectStore(TIMBRATURE_STORE)
    const request = store.getAll()
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

const SCHEDULE_ID = 'current'

export async function saveScheduleIndexedDB(state) {
  try {
    const db = await openDB()
    const tx = db.transaction(SCHEDULE_STORE, 'readwrite')
    const store = tx.objectStore(SCHEDULE_STORE)
    store.put({ id: SCHEDULE_ID, ...state })
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // ignora errori IndexedDB
  }
}

export async function loadScheduleIndexedDB() {
  try {
    const db = await openDB()
    const tx = db.transaction(SCHEDULE_STORE, 'readonly')
    const store = tx.objectStore(SCHEDULE_STORE)
    const request = store.get(SCHEDULE_ID)
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    if (!result) return { text: '', rows: [], baseDate: '' }
    return {
      text: typeof result.text === 'string' ? result.text : '',
      rows: Array.isArray(result.rows) ? result.rows : [],
      baseDate:
        typeof result.baseDate === 'string' ? result.baseDate : '',
    }
  } catch {
    return { text: '', rows: [], baseDate: '' }
  }
}
