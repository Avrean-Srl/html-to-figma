import {
  Button,
  Container,
  Dropdown,
  type DropdownOption,
  render,
  Tabs,
  type TabsOption,
  Text,
  TextboxMultiline,
  VerticalSpace
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { Fragment, h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { parseHtmlToIR } from './parser'
import { extractHtmlFromZip } from './parser/zip'
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
import { Banner } from './ui/Banner'
import { DropZone } from './ui/DropZone'

type Status = 'idle' | 'parsing' | 'importing' | 'done' | 'error'
type TabValue = 'file' | 'paste'

const VIEWPORT_OPTIONS: Array<DropdownOption> = [
  { value: '320', text: '320 — mobile' },
  { value: '768', text: '768 — tablet' },
  { value: '1024', text: '1024 — laptop' },
  { value: '1440', text: '1440 — desktop' },
  { value: '1920', text: '1920 — wide' }
]

function Plugin() {
  const [tab, setTab] = useState<TabValue>('file')
  const [html, setHtml] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [viewportWidth, setViewportWidth] = useState<string>('1440')
  const [status, setStatus] = useState<Status>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [imageFailures, setImageFailures] = useState<IRImageFailure[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean>(false)
  const settingsHydrated = useRef<boolean>(false)

  useEffect(() => {
    const unsubPong = on<PongHandler>('PONG', (_data: PongPayload) => {
      setBridgeOk(true)
    })
    const unsubSettings = on<SettingsLoadedHandler>(
      'SETTINGS_LOADED',
      (settings) => {
        settingsHydrated.current = true
        setViewportWidth(String(settings.viewportWidth))
      }
    )
    const unsubProgress = on<ImportProgressHandler>('IMPORT_PROGRESS', (p) => {
      setProgress(p)
    })
    const unsubDone = on<ImportCompleteHandler>('IMPORT_COMPLETE', (summary) => {
      setStatus('done')
      setProgress(null)
      setStatusDetail(
        `Imported ${summary.nodesCreated} node(s) in ${summary.durationMs} ms.`
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

  useEffect(() => {
    if (!settingsHydrated.current) return
    emit<SettingsChangedHandler>('SETTINGS_CHANGED', {
      viewportWidth: Number(viewportWidth)
    })
  }, [viewportWidth])

  async function handleFileSelected(file: File): Promise<void> {
    setSelectedFile(file)
    setStatus('idle')
    setStatusDetail('')
  }

  async function readSelectedFileToHtml(file: File): Promise<string> {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.zip')) {
      return extractHtmlFromZip(file)
    }
    if (
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      file.type === 'text/html'
    ) {
      return file.text()
    }
    throw new Error(
      'Unsupported file type. Drop a .html, .htm, or .zip file.'
    )
  }

  async function runImport(htmlString: string): Promise<void> {
    setStatus('parsing')
    setStatusDetail('')
    setImageFailures([])
    setProgress(null)
    try {
      const ir = await parseHtmlToIR(htmlString, {
        viewportWidth: Number(viewportWidth)
      })
      setStatus('importing')
      emit<ImportDocumentHandler>('IMPORT_DOCUMENT', ir)
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleImportFromFile(): Promise<void> {
    if (!selectedFile) return
    try {
      const htmlString = await readSelectedFileToHtml(selectedFile)
      await runImport(htmlString)
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleImportFromPaste(): Promise<void> {
    await runImport(html)
  }

  const isBusy = status === 'parsing' || status === 'importing'
  const canFileImport = selectedFile !== null && !isBusy
  const canPasteImport = html.trim().length > 0 && !isBusy

  const buttonLabel =
    status === 'parsing'
      ? 'Parsing…'
      : status === 'importing'
        ? progressLabel(progress)
        : 'Import to Figma'

  const fileTab = (
    <Fragment>
      <VerticalSpace space="medium" />
      <DropZone
        accept=".html,.htm,.zip,text/html,application/zip"
        onFileSelected={handleFileSelected}
        selectedFileName={selectedFile ? selectedFile.name : null}
      />
      <VerticalSpace space="small" />
      <Text style={{ opacity: 0.65, fontSize: 11 }}>
        Supports .html, .htm, and .zip archives containing one HTML file plus its image assets.
      </Text>
      <VerticalSpace space="medium" />
      <Button fullWidth disabled={!canFileImport} onClick={handleImportFromFile}>
        {buttonLabel}
      </Button>
    </Fragment>
  )

  const pasteTab = (
    <Fragment>
      <VerticalSpace space="medium" />
      <TextboxMultiline
        value={html}
        onValueInput={setHtml}
        rows={14}
        placeholder="<div style='padding: 16px; background: #f0f0f0'>Hello</div>"
      />
      <VerticalSpace space="medium" />
      <Button fullWidth disabled={!canPasteImport} onClick={handleImportFromPaste}>
        {buttonLabel}
      </Button>
    </Fragment>
  )

  const tabOptions: Array<TabsOption> = [
    { value: 'file', children: fileTab },
    { value: 'paste', children: pasteTab }
  ]

  return (
    <Fragment>
      <Banner />
      <Container space="medium">
        <VerticalSpace space="medium" />

        <Text>
          <strong>Viewport width</strong>
        </Text>
        <VerticalSpace space="small" />
        <Dropdown
          options={VIEWPORT_OPTIONS}
          value={viewportWidth}
          onValueChange={setViewportWidth}
        />
        <VerticalSpace space="medium" />

        <Tabs
          options={tabOptions}
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
        />

        <VerticalSpace space="small" />

        <Text>
          {status === 'error' && `Error — ${statusDetail}`}
          {status === 'done' && statusDetail}
          {status === 'idle' && (bridgeOk ? 'Bridge OK.' : 'Connecting…')}
          {isBusy && progressLabel(progress)}
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
    </Fragment>
  )
}

function progressLabel(p: ImportProgress | null): string {
  if (p === null) return 'Working…'
  if (p.stage === 'fonts') return `Loading fonts ${p.current}/${p.total}…`
  if (p.stage === 'nodes') return `Creating nodes ${p.current}/${p.total}…`
  return 'Finishing…'
}

export default render(Plugin)
