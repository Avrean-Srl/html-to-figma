import { h, type JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'

interface DropZoneProps {
  accept: string
  onFileSelected: (file: File) => void
  selectedFileName: string | null
}

// Persistent drop target: a visible dashed box that also doubles as a
// click-to-browse trigger. Dragging anywhere over the box swaps the
// border color and background to the Figma brand tokens. Keeps the
// file input hidden because the styled box is the affordance.
export function DropZone({ accept, onFileSelected, selectedFileName }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  function openPicker(): void {
    inputRef.current?.click()
  }

  function handleChange(e: JSX.TargetedEvent<HTMLInputElement>): void {
    const file = e.currentTarget.files?.[0]
    if (file) onFileSelected(file)
    // Reset so the same file picked twice still fires change.
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDragEnter(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }

  function handleDragLeave(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }

  function handleDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) onFileSelected(file)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openPicker()
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${
          isDragging
            ? 'var(--figma-color-border-brand)'
            : 'var(--figma-color-border)'
        }`,
        borderRadius: 8,
        padding: '28px 16px',
        textAlign: 'center',
        background: isDragging
          ? 'var(--figma-color-bg-brand-tertiary)'
          : 'var(--figma-color-bg-secondary)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.55 }}
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 500 }}>
        {selectedFileName ? selectedFileName : 'Drag-and-drop a file here'}
      </div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>
        {selectedFileName ? 'Click to replace' : 'or click to browse'}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
