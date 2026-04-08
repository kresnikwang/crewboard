/**
 * useDragSelect — handles drag-to-select multiple date cells to create a booking
 */
import { ref } from 'vue'

export function useDragSelect({ onSelectDone }) {
  const selecting = ref(false)
  const selectedCells = ref([]) // array of { date, resourceId }

  let _startCell = null
  let _isDragging = false
  let _blockClick = false

  function onCellMousedown(e, date, resourceId, allCellsForResource) {
    // Only left button, not on booking block
    if (e.button !== 0) return
    if (e.target.closest('.booking-block, .m-booking')) return

    _startCell = { date, resourceId }
    _isDragging = false
    _blockClick = false

    const onMove = (ev) => {
      if (!_isDragging) {
        _isDragging = true
        selecting.value = true
      }
      _updateSelection(ev, allCellsForResource)
    }

    const onUp = () => {
      if (_isDragging && selectedCells.value.length >= 1) {
        _blockClick = true
        const cells = selectedCells.value.slice()
        clearSelection()
        onSelectDone({
          resourceId,
          startDate: cells[0].date,
          endDate: cells[cells.length - 1].date,
        })
        // Prevent click from firing on the cell
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

  function _updateSelection(e, allCells) {
    if (!_startCell) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    const cell = el.closest('[data-date][data-resource]')
    if (!cell) return
    if (cell.dataset.resource !== String(_startCell.resourceId)) return

    const startDate = _startCell.date
    const endDate = cell.dataset.date

    // Find range in allCells
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
    _startCell = null
    _isDragging = false
  }

  function isBlockingClick() {
    return _blockClick
  }

  return { selecting, selectedCells, onCellMousedown, clearSelection, isBlockingClick }
}
