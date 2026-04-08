/**
 * useBookingDrag — handles resize (extend/shrink) and move (translate) of booking blocks
 * Works for both week-view and month-view cells.
 */
import { ref } from 'vue'
import { fmt, parseDate, addDays, diffDays } from '@/utils/date'

export function useBookingDrag({ onResizeDone, onMoveDone }) {
  // ── Resize state ──────────────────────────────────────────────
  const resizing = ref(false)
  const resizePreviewCells = ref([]) // { date, mode: 'add'|'remove' }

  let _resizeCtx = null

  function startResize(e, booking, allBookingsForGroup, cellDateGetter) {
    e.preventDefault()
    e.stopPropagation()
    resizing.value = true
    _resizeCtx = {
      booking,
      group: allBookingsForGroup, // sorted array of same resource+project bookings
      cellDateGetter,             // fn(el) => 'YYYY-MM-DD'
      startX: e.clientX,
    }

    const onMove = (ev) => _onResizeMove(ev)
    const onUp   = (ev) => { _onResizeUp(ev); cleanup() }
    const onKey  = (ev) => { if (ev.key === 'Escape') { cleanup(); resizing.value = false; resizePreviewCells.value = [] } }

    function cleanup() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  }

  function _onResizeMove(e) {
    if (!_resizeCtx) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-date]')
    if (!cell) return
    const hoverDate = cell.dataset.date
    if (!hoverDate) return

    const ctx = _resizeCtx
    const group = ctx.group
    const lastDate = group[group.length - 1].date

    const delta = diffDays(parseDate(lastDate), parseDate(hoverDate))
    const previews = []

    if (delta > 0) {
      // Extending: highlight new dates
      for (let i = 1; i <= delta; i++) {
        previews.push({ date: fmt(addDays(parseDate(lastDate), i)), mode: 'add' })
      }
    } else if (delta < 0) {
      // Shrinking: highlight dates to remove (keep at least 1)
      const removeCount = Math.min(Math.abs(delta), group.length - 1)
      for (let i = 0; i < removeCount; i++) {
        previews.push({ date: group[group.length - 1 - i].date, mode: 'remove' })
      }
    }

    resizePreviewCells.value = previews
  }

  async function _onResizeUp(e) {
    if (!_resizeCtx) return
    const ctx = _resizeCtx
    _resizeCtx = null
    resizing.value = false

    const previews = resizePreviewCells.value
    resizePreviewCells.value = []

    if (!previews.length) return

    const addDates = previews.filter(p => p.mode === 'add').map(p => p.date)
    const removeDates = previews.filter(p => p.mode === 'remove').map(p => p.date)

    await onResizeDone({ booking: ctx.booking, group: ctx.group, addDates, removeDates })
  }

  // ── Move state ────────────────────────────────────────────────
  const moving = ref(false)
  const movePreviewCells = ref([]) // dates that will be the new positions

  let _moveCtx = null

  function startMove(e, booking, allBookingsForGroup) {
    // Don't start move on resize handle
    if (e.target.classList.contains('resize-handle')) return

    let hasMoved = false
    const startX = e.clientX
    const startY = e.clientY

    const onMove = (ev) => {
      if (!hasMoved && (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5)) {
        hasMoved = true
        moving.value = true
        _moveCtx = { booking, group: allBookingsForGroup }
      }
      if (hasMoved) _onMoveMove(ev)
    }
    const onUp = (ev) => {
      if (hasMoved) _onMoveUp(ev)
      cleanup()
    }
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        cleanup()
        moving.value = false
        movePreviewCells.value = []
        _moveCtx = null
      }
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
      if (!hasMoved) moving.value = false
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  }

  function _onMoveMove(e) {
    if (!_moveCtx) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-date]')
    if (!cell) return
    const hoverDate = cell.dataset.date
    if (!hoverDate) return

    const ctx = _moveCtx
    const group = ctx.group
    const firstDate = group[0].date
    const delta = diffDays(parseDate(firstDate), parseDate(hoverDate))

    if (delta === 0) { movePreviewCells.value = []; return }

    const newDates = group.map(b => fmt(addDays(parseDate(b.date), delta)))
    movePreviewCells.value = newDates
  }

  async function _onMoveUp(e) {
    if (!_moveCtx) return
    const ctx = _moveCtx
    _moveCtx = null
    moving.value = false

    const newDates = movePreviewCells.value
    movePreviewCells.value = []

    if (!newDates.length) return

    const firstDate = ctx.group[0].date
    const delta = diffDays(parseDate(firstDate), parseDate(newDates[0]))

    await onMoveDone({ booking: ctx.booking, group: ctx.group, delta, newDates })
  }

  return {
    resizing, resizePreviewCells, startResize,
    moving, movePreviewCells, startMove,
  }
}
