import {
  Container,
  render,
  Text,
  VerticalSpace
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import type {
  PingHandler,
  PongHandler,
  PongPayload
} from './types/messages'

function Plugin() {
  const [pong, setPong] = useState<PongPayload | null>(null)

  useEffect(() => {
    const unsubscribe = on<PongHandler>('PONG', (data) => {
      setPong(data)
    })
    emit<PingHandler>('PING')
    return unsubscribe
  }, [])

  return (
    <Container space="medium">
      <VerticalSpace space="large" />
      <Text>
        <strong>HTML to Figma</strong>
      </Text>
      <VerticalSpace space="small" />
      <Text>Phase 0 scaffold OK.</Text>
      <VerticalSpace space="small" />
      <Text>
        {pong === null
          ? 'Pinging main thread...'
          : `Bridge OK — main responded v${pong.version} at ${new Date(pong.receivedAt).toLocaleTimeString()}`}
      </Text>
      <VerticalSpace space="large" />
    </Container>
  )
}

export default render(Plugin)
