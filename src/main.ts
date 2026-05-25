import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type { PingHandler, PongHandler } from './types/messages'

const PLUGIN_VERSION = '0.1.0'

export default function (): void {
  on<PingHandler>('PING', () => {
    emit<PongHandler>('PONG', {
      version: PLUGIN_VERSION,
      receivedAt: Date.now()
    })
  })
  showUI({ width: 480, height: 540 })
}
