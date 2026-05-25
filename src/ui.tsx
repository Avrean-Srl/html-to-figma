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
import { Fragment, h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import { parseHtmlToIR } from './parser'
import type { IRImageFailure } from './types/ir'
import type {
  ImportCompleteHandler,
  ImportDocumentHandler,
  ImportErrorHandler,
  PingHandler,
  PongHandler
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
  const [imageFailures, setImageFailures] = useState<IRImageFailure[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean>(false)

  useEffect(() => {
    const unsubPong = on<PongHandler>('PONG', () => {
      setBridgeOk(true)
    })
    const unsubDone = on<ImportCompleteHandler>('IMPORT_COMPLETE', (summary) => {
      setStatus('done')
      setStatusDetail(
        `Imported ${summary.nodesCreated} node(s) in ${summary.durationMs}ms.`
      )
      setImageFailures(summary.imageFailures)
    })
    const unsubErr = on<ImportErrorHandler>('IMPORT_ERROR', (err) => {
      setStatus('error')
      setStatusDetail(`${err.code}: ${err.message}`)
    })
    emit<PingHandler>('PING')
    return () => {
      unsubPong()
      unsubDone()
      unsubErr()
    }
  }, [])

  const canImport =
    html.trim().length > 0 &&
    (status === 'idle' || status === 'done' || status === 'error')

  async function handleImport() {
    setStatus('parsing')
    setStatusDetail('')
    setImageFailures([])
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

  const buttonLabel =
    status === 'parsing'
      ? 'Parsing...'
      : status === 'importing'
        ? 'Importing...'
        : 'Import to Figma'

  return (
    <Container space="medium">
      <VerticalSpace space="large" />
      <Text>
        <strong>HTML to Figma</strong>
      </Text>
      <VerticalSpace space="extraSmall" />
      <Text>
        Phase 1 MVP — supports basic divs, text, colors, and absolute layout.
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
        {status === 'idle' && (bridgeOk ? 'Bridge OK.' : 'Connecting...')}
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
  )
}

export default render(Plugin)
