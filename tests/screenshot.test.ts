import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { StateServer } from '../src/server/index.js'
import { DreamFrameSource } from '../src/client/source.js'
import { DreamFrameController } from '../src/client/controller.js'
import type { CommandResult, Screenshot } from '../src/core/types.js'
import type { WebSocketCtorLike } from '../src/client/source.js'

describe('DreamFrame screenshots', () => {
    let server: StateServer | undefined
    let source: DreamFrameSource | undefined
    let controller: DreamFrameController | undefined

    afterEach(async () => {
        source?.close()
        controller?.close()
        if (server) await server.stop()
    })

    it('captures a browser frame through source and controller', async () => {
        server = await StateServer.create({ port: 0 })
        const screenshot: Screenshot = {
            mimeType: 'image/png',
            data: 'data:image/png;base64,ZmFrZQ==',
            width: 640,
            height: 360,
            capturedAt: new Date().toISOString(),
        }
        source = new DreamFrameSource({
            namespace: 'game:session',
            WebSocket: WebSocket as unknown as WebSocketCtorLike,
            captureScreenshot: () => screenshot,
        })
        await source.connect(`ws://localhost:${server.port}`)

        controller = new DreamFrameController({
            namespace: 'game:session',
            url: `ws://localhost:${server.port}`,
        })
        await controller.connect()

        const received = await controller.screenshot()
        expect(received).toEqual(screenshot)
    })

    it('auto-captures a frame after a custom command, so commandAndCapture resolves', async () => {
        server = await StateServer.create({ port: 0 })
        const screenshot: Screenshot = {
            mimeType: 'image/png',
            data: 'data:image/png;base64,ZmFrZQ==',
            width: 640,
            height: 360,
            capturedAt: new Date().toISOString(),
        }
        source = new DreamFrameSource({
            namespace: 'editor:auto',
            WebSocket: WebSocket as unknown as WebSocketCtorLike,
            captureScreenshot: () => screenshot,
        })
        source.onCommand((command) => {
            const result: CommandResult = {
                requestId: String(command.payload.requestId),
                ok: true,
                operation: 'editor.example',
                revision: 1,
                changed: true,
                message: 'done',
            }
            void source?.putResult(result)
        })
        await source.connect(`ws://localhost:${server.port}`)

        controller = new DreamFrameController({
            namespace: 'editor:auto',
            url: `ws://localhost:${server.port}`,
        })
        await controller.connect()

        const capture = await controller.commandAndCapture('one-shot', {
            action: 'editor',
            operation: 'editor.example',
        })
        expect(capture.result.ok).toBe(true)
        expect(capture.screenshot).toEqual(screenshot)
    })
})
