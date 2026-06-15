import {
  Button,
  Checkbox,
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
import { extractHtmlsFromZip, type ZipPage } from './parser/zip'
import type { IRImageFailure } from './types/ir'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportDocumentsHandler,
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
  { value: '320', text: '320 px  ·  mobile' },
  { value: '768', text: '768 px  ·  tablet' },
  { value: '1024', text: '1024 px  ·  laptop' },
  { value: '1440', text: '1440 px  ·  desktop' },
  { value: '1920', text: '1920 px  ·  wide' }
]

function Plugin() {
  const [tab, setTab] = useState<TabValue>('file')
  const [html, setHtml] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [viewportWidth, setViewportWidth] = useState<string>('1440')
  const [linkInteractions, setLinkInteractions] = useState<boolean>(false)
  const [status, setStatus] = useState<Status>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [imageFailures, setImageFailures] = useState<IRImageFailure[]>([])
  const [, setBridgeOk] = useState<boolean>(false)
  const [pluginVersion, setPluginVersion] = useState<string>('—')
  const settingsHydrated = useRef<boolean>(false)

  useEffect(() => {
    const unsubPong = on<PongHandler>('PONG', (data: PongPayload) => {
      setBridgeOk(true)
      setPluginVersion(data.version)
    })
    const unsubSettings = on<SettingsLoadedHandler>(
      'SETTINGS_LOADED',
      (settings) => {
        settingsHydrated.current = true
        setViewportWidth(String(settings.viewportWidth))
        setLinkInteractions(Boolean(settings.linkInteractions))
      }
    )
    const unsubProgress = on<ImportProgressHandler>('IMPORT_PROGRESS', (p) => {
      setProgress(p)
    })
    const unsubDone = on<ImportCompleteHandler>('IMPORT_COMPLETE', (summary) => {
      setStatus('done')
      setProgress(null)
      const linkPart =
        summary.linksWired && summary.linksWired > 0
          ? ` · ${summary.linksWired} link${summary.linksWired === 1 ? '' : 's'} wired`
          : ''
      setStatusDetail(
        `Imported ${summary.nodesCreated} node${summary.nodesCreated === 1 ? '' : 's'} in ${summary.durationMs} ms${linkPart}`
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
      viewportWidth: Number(viewportWidth),
      linkInteractions
    })
  }, [viewportWidth, linkInteractions])

  async function handleFileSelected(file: File): Promise<void> {
    setSelectedFile(file)
    setStatus('idle')
    setStatusDetail('')
    setImageFailures([])
  }

  async function runImportFromHtml(htmlString: string): Promise<void> {
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

  // Parse every top-level HTML in the ZIP into its own IR, then send the
  // batch to the main thread for side-by-side materialization. We surface
  // parse progress as a synthetic stage so a 13-page archive doesn't look
  // frozen while pages 2..13 are still being measured.
  async function runImportFromZipPages(pages: ZipPage[]): Promise<void> {
    setStatus('parsing')
    setStatusDetail('')
    setImageFailures([])
    setProgress({
      stage: 'parsing',
      current: 0,
      total: pages.length,
      pageCount: pages.length
    })
    try {
      const irs: Array<{ name: string; doc: Awaited<ReturnType<typeof parseHtmlToIR>> }> = []
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        setProgress({
          stage: 'parsing',
          current: i,
          total: pages.length,
          pageIndex: i,
          pageCount: pages.length,
          pageName: page.name
        })
        const doc = await parseHtmlToIR(page.html, {
          viewportWidth: Number(viewportWidth)
        })
        irs.push({ name: page.name, doc })
      }
      setStatus('importing')
      emit<ImportDocumentsHandler>('IMPORT_DOCUMENTS', {
        pages: irs,
        linkInteractions
      })
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleImportFromFile(): Promise<void> {
    if (!selectedFile) return
    const lower = selectedFile.name.toLowerCase()
    try {
      if (lower.endsWith('.zip')) {
        const pages = await extractHtmlsFromZip(selectedFile)
        if (pages.length === 0) {
          throw new Error('No .html file found in the ZIP.')
        }
        if (pages.length === 1) {
          await runImportFromHtml(pages[0].html)
        } else {
          await runImportFromZipPages(pages)
        }
        return
      }
      if (
        lower.endsWith('.html') ||
        lower.endsWith('.htm') ||
        selectedFile.type === 'text/html'
      ) {
        const text = await selectedFile.text()
        await runImportFromHtml(text)
        return
      }
      throw new Error(
        'Unsupported file type. Drop a .html, .htm, or .zip file.'
      )
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleImportFromPaste(): Promise<void> {
    await runImportFromHtml(html)
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
      <div
        style={{
          fontSize: 11,
          opacity: 0.6,
          lineHeight: '16px'
        }}
      >
        Supports .html, .htm, and .zip archives with image assets.
      </div>
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
        rows={7}
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

        <SectionLabel>Viewport width</SectionLabel>
        <VerticalSpace space="small" />
        <Dropdown
          options={VIEWPORT_OPTIONS}
          value={viewportWidth}
          onValueChange={setViewportWidth}
        />
        <VerticalSpace space="medium" />

        <SectionLabel>Prototype</SectionLabel>
        <VerticalSpace space="small" />
        <Checkbox value={linkInteractions} onValueChange={setLinkInteractions}>
          <Text>Link prototype interactions</Text>
        </Checkbox>
        <VerticalSpace space="extraSmall" />
        <div
          style={{
            fontSize: 11,
            opacity: 0.6,
            lineHeight: '16px'
          }}
        >
          Follows internal links (&lt;a href&gt; / buttons) and wires
          frame-to-frame navigation. Multi-page imports (.zip) only.
        </div>
        <VerticalSpace space="medium" />

        <Tabs
          options={tabOptions}
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
        />

        <StatusLine status={status} detail={statusDetail} progress={progress} />

        {imageFailures.length > 0 && (
          <ImageFailuresList failures={imageFailures} />
        )}

        <VerticalSpace space="medium" />
        <Footer version={pluginVersion} />
      </Container>
    </Fragment>
  )
}

function SectionLabel({ children }: { children: preact.ComponentChildren }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        opacity: 0.7
      }}
    >
      {children}
    </div>
  )
}

function StatusLine({
  status,
  detail,
  progress
}: {
  status: Status
  detail: string
  progress: ImportProgress | null
}) {
  if (status === 'idle') {
    return <VerticalSpace space="small" />
  }

  const isError = status === 'error'
  const isDone = status === 'done'
  const isBusy = status === 'parsing' || status === 'importing'

  const color = isError
    ? 'var(--figma-color-text-danger)'
    : isDone
      ? 'var(--figma-color-text-success, #2bb673)'
      : 'var(--figma-color-text-secondary)'

  const icon = isError ? '⚠' : isDone ? '✓' : '⋯'

  const message = isBusy ? progressLabel(progress) : detail

  return (
    <Fragment>
      <VerticalSpace space="medium" />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 6,
          background: 'var(--figma-color-bg-secondary)',
          color,
          fontSize: 11,
          lineHeight: '15px'
        }}
      >
        <span style={{ fontSize: 12, lineHeight: '15px' }}>{icon}</span>
        <span style={{ flex: 1, wordBreak: 'break-word' }}>{message}</span>
      </div>
    </Fragment>
  )
}

function ImageFailuresList({ failures }: { failures: IRImageFailure[] }) {
  return (
    <Fragment>
      <VerticalSpace space="small" />
      <div
        style={{
          border: '1px solid var(--figma-color-border)',
          borderRadius: 6,
          padding: '10px 12px',
          background: 'var(--figma-color-bg)',
          fontSize: 11,
          lineHeight: '15px'
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <span style={{ color: 'var(--figma-color-text-danger)' }}>
            {failures.length}
          </span>
          <span>image{failures.length === 1 ? '' : 's'} failed to load</span>
        </div>
        <div
          style={{
            maxHeight: 110,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          {failures.map((f) => (
            <div
              key={f.sourceUrl}
              style={{ wordBreak: 'break-all', opacity: 0.85 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 6px',
                  marginRight: 6,
                  borderRadius: 3,
                  background: 'var(--figma-color-bg-secondary)',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}
              >
                {f.reason}
              </span>
              {f.sourceUrl}
            </div>
          ))}
        </div>
      </div>
    </Fragment>
  )
}

function Footer({ version }: { version: string }) {
  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 10,
        borderTop: '1px solid var(--figma-color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 10,
        opacity: 0.55,
        lineHeight: '14px'
      }}
    >
      <span>
        v{version}  ·  by{' '}
        <a
          href="https://redergo.com"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          Redergo
        </a>
      </span>
      <a
        href="https://github.com/Avrean-Srl/html-to-figma"
        target="_blank"
        rel="noreferrer"
        style={{
          color: 'inherit',
          textDecoration: 'none'
        }}
      >
        github.com/Avrean-Srl/html-to-figma
      </a>
    </div>
  )
}

function progressLabel(p: ImportProgress | null): string {
  if (p === null) return 'Working…'
  const pagePrefix =
    p.pageIndex !== undefined && p.pageCount !== undefined && p.pageCount > 1
      ? `Page ${p.pageIndex + 1}/${p.pageCount}${p.pageName ? ` (${p.pageName})` : ''} · `
      : ''
  if (p.stage === 'parsing') {
    return `${pagePrefix}Parsing HTML…`
  }
  if (p.stage === 'fonts') return `${pagePrefix}Loading fonts ${p.current}/${p.total}…`
  if (p.stage === 'nodes') return `${pagePrefix}Creating nodes ${p.current}/${p.total}…`
  return `${pagePrefix}Finishing…`
}

export default render(Plugin)
