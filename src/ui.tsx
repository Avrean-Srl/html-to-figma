import {
  Button,
  Container,
  Dropdown,
  type DropdownOption,
  render,
  Text,
  TextboxMultiline,
  VerticalSpace
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { Fragment, h, type JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { parseHtmlToIR } from './parser'
import type { IRImageFailure } from './types/ir'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportErrorHandler,
  ImportProgress,
  ImportProgressHandler,
  PingHandler,
  PongHandler,
  PongPayload,
  SettingsChangedHandler,
  SettingsLoadedHandler
} from './types/messages'

type Status = 'idle' | 'parsing' | 'importing' | 'done' | 'error'

const VIEWPORT_OPTIONS: Array<DropdownOption> = [
  { value: '320', text: '320 — mobile' },
  { value: '768', text: '768 — tablet' },
  { value: '1024', text: '1024 — laptop' },
  { value: '1440', text: '1440 — desktop' },
  { value: '1920', text: '1920 — wide' }
]

function Plugin() {
  const [html, setHtml] = useState<string>('')
  const [viewportWidth, setViewportWidth] = useState<string>('1440')
  const [status, setStatus] = useState<Status>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [imageFailures, setImageFailures] = useState<IRImageFailure[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean>(false)
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const settingsHydrated = useRef<boolean>(false)

  useEffect(() => {
    const unsubPong = on<PongHandler>('PONG', (data: PongPayload) => {
      setBridgeOk(true)
      // Mark bridge OK in dev — main already pongs once on PING.
      void data
    })
    const unsubSettings = on<SettingsLoadedHandler>(
      'SETTINGS_LOADED',
      (settings) => {
        settingsHydrated.current = true
        setViewportWidth(String(settings.viewportWidth))
      }
    )
    const unsubProgress = on<ImportProgressHandler>(
      'IMPORT_PROGRESS',
      (p) => {
        setProgress(p)
      }
    )
    const unsubDone = on<ImportCompleteHandler>('IMPORT_COMPLETE', (summary) => {
      setStatus('done')
      setProgress(null)
      setStatusDetail(
        `Imported ${summary.nodesCreated} node(s) in ${summary.durationMs}ms.`
      )
      setImageFailures(summary.imageFailures)
    })
    const unsubErr = on<ImportErrorHandler>('IMPORT_ERROR', (err) => {
      setStatus('error')
      setProgress(null)
      setStatusDetail(`${err.code}: ${err.message}`)
    })
    emit<PingHandler>('PING')
    return () => {
      unsubPong()
      unsubSettings()
      unsubProgress()
      unsubDone()
      unsubErr()
    }
  }, [])

  // Persist viewport changes after the initial hydration from main, so we
  // don't double-write the same value back on first load.
  useEffect(() => {
    if (!settingsHydrated.current) return
    emit<SettingsChangedHandler>('SETTINGS_CHANGED', {
      viewportWidth: Number(viewportWidth)
    })
  }, [viewportWidth])

  const canImport =
    html.trim().length > 0 &&
    (status === 'idle' || status === 'done' || status === 'error')

  async function handleImport(): Promise<void> {
    setStatus('parsing')
    setStatusDetail('')
    setImageFailures([])
    setProgress(null)
    try {
      const ir = await parseHtmlToIR(html, {
        viewportWidth: Number(viewportWidth)
      })
      setStatus('importing')
      emit<ImportDocumentHandler>('IMPORT_DOCUMENT', ir)
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : String(err))
    }
  }

  function handleDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  function handleDragLeave(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setIsDragging(false)
  }

  async function handleDrop(e: JSX.TargetedDragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    const isHtml =
      file.name.toLowerCase().endsWith('.html') ||
      file.name.toLowerCase().endsWith('.htm') ||
      file.type === 'text/html'
    if (!isHtml) {
      setStatus('error')
      setStatusDetail('Only .html and .htm files can be dropped here.')
      return
    }
    try {
      const text = await file.text()
      setHtml(text)
      setStatus('idle')
      setStatusDetail('')
    } catch (err) {
      setStatus('error')
      setStatusDetail(
        `Could not read file: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const buttonLabel =
    status === 'parsing'
      ? 'Parsing…'
      : status === 'importing'
        ? progressLabel(progress)
        : 'Import to Figma'

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        minHeight: '100vh',
        outline: isDragging ? '2px dashed var(--figma-color-border-brand)' : 'none',
        outlineOffset: '-4px'
      }}
    >
      <Container space="medium">
        <VerticalSpace space="large" />
        <Text>
          <strong>HTML to Figma</strong>
        </Text>
        <VerticalSpace space="extraSmall" />
        <Text>
          Paste HTML below, or drag a .html file onto the plugin window.
        </Text>
        <VerticalSpace space="large" />

        <Text>
          <strong>Viewport width</strong>
        </Text>
        <VerticalSpace space="small" />
        <Dropdown
          options={VIEWPORT_OPTIONS}
          value={viewportWidth}
          onValueChange={setViewportWidth}
        />
        <VerticalSpace space="large" />

        <Text>
          <strong>HTML</strong>
        </Text>
        <VerticalSpace space="small" />
        <TextboxMultiline
          value={html}
          onValueInput={setHtml}
          rows={12}
          placeholder="<div style='padding: 16px; background: #f0f0f0'>Hello</div>"
        />
        <VerticalSpace space="large" />

        <Button fullWidth disabled={!canImport} onClick={handleImport}>
          {buttonLabel}
        </Button>
        <VerticalSpace space="small" />

        <Text>
          {status === 'error' && `Error — ${statusDetail}`}
          {status === 'done' && statusDetail}
          {status === 'idle' && (bridgeOk ? 'Bridge OK.' : 'Connecting…')}
          {(status === 'parsing' || status === 'importing') && progressLabel(progress)}
        </Text>

        {imageFailures.length > 0 && (
          <Fragment>
            <VerticalSpace space="medium" />
            <Text>
              <strong>{imageFailures.length} image(s) failed to load:</strong>
            </Text>
            <VerticalSpace space="extraSmall" />
            {imageFailures.map((f) => (
              <Text key={f.sourceUrl}>
                {f.reason}: {f.sourceUrl}
              </Text>
            ))}
          </Fragment>
        )}

        <VerticalSpace space="medium" />
      </Container>
    </div>
  )
}

function progressLabel(p: ImportProgress | null): string {
  if (p === null) return 'Working…'
  if (p.stage === 'fonts') return `Loading fonts ${p.current}/${p.total}…`
  if (p.stage === 'nodes') return `Creating nodes ${p.current}/${p.total}…`
  return 'Finishing…'
}

export default render(Plugin)
