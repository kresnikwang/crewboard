/**
 * useDragSelect — handles drag-to-select multiple date cells to create a booking
 * Supports two call signatures:
 *   1. useDragSelect({ onSelectDone })  — used by WeekView (legacy)
 *   2. useDragSelect(scrollRef, callback)  — used by MonthView
 */
import { ref } from 'vue'

export function useDragSelect(arg1, arg2) {
  // Normalize: if second arg is a function, it's the new MonthView signature
  const isNewSignature = typeof arg2 === 'function'
  const legacyOnSelectDone = isNewSignature ? null : (arg1 && arg1.onSelectDone) || (() => {})
  const newOnSelectDone = isNewSignature ? arg2 : null

  const selecting = ref(false)
  const selectedCells = ref([]) // array of { date, resourceId }

  let _startResourceId = null
  let _startDate = null
  let _isDragging = false
  let _blockClick = false

  // ── New interface (MonthView): onCellMouseDown(e, resourceId, dateStr) ──
  function onCellMouseDown(e, resourceId, dateStr) {
    if (e.button !== 0) return

    _startResourceId = resourceId
    _startDate = dateStr
    _isDragging = false
    _blockClick = false

    const onMove = (ev) => {
      if (!_isDragging) {
        _isDragging = true
        selecting.value = true
      }
      _updateSelectionFromDOM(ev, resourceId)
    }

    const onUp = () => {
      if (_isDragging && selectedCells.value.length >= 1) {
        _blockClick = true
        const cells = selectedCells.value.slice()
        clearSelection()
        if (newOnSelectDone) {
          newOnSelectDone(resourceId, cells[0].date, cells[cells.length - 1].date)
        }
        setTimeout(() => { _blockClick = false }, 200)
      } else if (!_isDragging) {
        // Single click: single-day create
        clearSelection()
        if (newOnSelectDone) {
          newOnSelectDone(resourceId, dateStr, dateStr)
        }
      } else {
        clearSelection()
      }
      cleanup()
    }

    const onKey = (ev) => {
      if (ev.key === 'Escape') { clearSelection(); cleanup() }
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  }

  // ── Legacy interface (WeekView): onCellMousedown(e, date, resourceId, allCells) ──
  function onCellMousedown(e, date, resourceId, allCellsForResource) {
    if (e.button !== 0) return
    if (e.target.closest('.booking-block, .m-booking')) return

    _startResourceId = resourceId
    _startDate = date
    _isDragging = false
    _blockClick = false

    const onMove = (ev) => {
      if (!_isDragging) {
        _isDragging = true
        selecting.value = true
      }
      _updateSelectionFromCells(ev, allCellsForResource, resourceId)
    }

    const onUp = () => {
      if (_isDragging && selectedCells.value.length >= 1) {
        _blockClick = true
        const cells = selectedCells.value.slice()
        clearSelection()
        if (legacyOnSelectDone) {
          legacyOnSelectDone({
            resourceId,
            startDate: cells[0].date,
            endDate: cells[cells.length - 1].date,
          })
        }
        setTimeout(() => { _blockClick = false }, 200)
      } else {
        clearSelection()
      }
      cleanup()
    }

    const onKey = (ev) => {
      if (ev.key === 'Escape') { clearSelection(); cleanup() }
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  }

  function _updateSelectionFromDOM(e, resourceId) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-date][data-resource]')
    if (!cell) return
    if (String(cell.dataset.resource) !== String(resourceId)) return

    const startDate = _startDate
    const endDate = cell.dataset.date
    if (!startDate || !endDate) return

    // Collect all cells for this resource in DOM order
    const allCells = Array.from(
      document.querySelectorAll(`[data-resource="${resourceId}"][data-date]`)
    ).map(c => ({ date: c.dataset.date, resourceId }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const dates = allCells.map(c => c.date)
    const si = dates.indexOf(startDate)
    const ei = dates.indexOf(endDate)
    if (si === -1 || ei === -1) return

    const [lo, hi] = si <= ei ? [si, ei] : [ei, si]
    selectedCells.value = allCells.slice(lo, hi + 1)
  }

  function _updateSelectionFromCells(e, allCells, resourceId) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-date][data-resource]')
    if (!cell) return
    if (cell.dataset.resource !== String(resourceId)) return

    const startDate = _startDate
    const endDate = cell.dataset.date

    const dates = allCells.map(c => c.date)
    const si = dates.indexOf(startDate)
    const ei = dates.indexOf(endDate)
    if (si === -1 || ei === -1) return

    const [lo, hi] = si <= ei ? [si, ei] : [ei, si]
    selectedCells.value = allCells.slice(lo, hi + 1)
  }

  function clearSelection() {
    selecting.value = false
    selectedCells.value = []
    _startResourceId = null
    _startDate = null
    _isDragging = false
  }

  function isBlockingClick() {
    return _blockClick
  }

  return { selecting, selectedCells, onCellMouseDown, onCellMousedown, clearSelection, isBlockingClick }
}
