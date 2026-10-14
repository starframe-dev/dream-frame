import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { StateServer } from '../src/server/index.js'
import { DreamFrameSource } from '../src/client/source.js'
import { DreamFrameController } from '../src/client/controller.js'
import type { CommandResult, Screenshot } from '../src/core/types.js'
import type { WebSocketCtorLike } from '../src/client/source.js'

describe('DreamFrame command results', () => {
    let server: StateServer | undefined
    let source: DreamFrameSource | undefined
    let controller: DreamFrameController | undefined

    afterEach(async () => {
        source?.close()
        controller?.close()
        if (server) await server.stop()
    })

    it('waits for a result sent by the browser source', async () => {
        server = await StateServer.create({ port: 0 })
        const screenshot: Screenshot = {
            mimeType: 'image/png',
            data: 'data:image/png;base64,ZmFrZQ==',
            width: 640,
            height: 360,
            capturedAt: new Date().toISOString(),
        }
        source = new DreamFrameSource({
            namespace: 'editor:session',
            WebSocket: WebSocket as unknown as WebSocketCtorLike
        })
        source.onCommand((command) => {
            const result: CommandResult = {
                requestId: String(command.payload.requestId),
                ok: true,
                operation: 'terrain.brush',
                revision: 4,
                changed: true,
                message: 'Terrain поднят'
            }
            void Promise.all([
                source?.putResult(result),
                source?.putScreenshot(String(command.payload.requestId), screenshot),
            ])
        })
        await source.connect(`ws://localhost:${server.port}`)

        controller = new DreamFrameController({
            namespace: 'editor:session',
            url: `ws://localhost:${server.port}`
        })
        await controller.connect()

        const response = await controller.commandAndCapture('one-shot', {
            action: 'editor',
            operation: 'terrain.brush'
        })
        expect(response.result).toMatchObject({
            ok: true,
            operation: 'terrain.brush',
            revision: 4
        })
        expect(response.screenshot).toEqual(screenshot)
    })
})
