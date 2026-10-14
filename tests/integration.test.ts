import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { StateServer } from '../src/server/index.js'
import type { ServerMessage, SceneSnapshot } from '../src/core/types.js'

interface MsgSocket {
    ws: WebSocket
    next(): Promise<ServerMessage>
}

describe('StateServer integration', () => {
    let server: StateServer

    beforeEach(async () => {
        server = await StateServer.create({ port: 0 })
    })

    afterEach(async () => {
        await server.stop()
    })

    function connect(url: string): Promise<MsgSocket> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url)
            const messages: ServerMessage[] = []
            let pendingResolve: ((msg: ServerMessage) => void) | null = null

            ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString()) as ServerMessage
                if (pendingResolve) {
                    pendingResolve(msg)
                    pendingResolve = null
                } else {
                    messages.push(msg)
                }
            })

            ws.once('open', () => resolve({ ws, next }))
            ws.once('error', reject)

            function next(): Promise<ServerMessage> {
                if (messages.length > 0) {
                    return Promise.resolve(messages.shift()!)
                }
                return new Promise((resolveNext) => {
                    pendingResolve = resolveNext
                })
            }
        })
    }

    async function register(socket: MsgSocket, role: 'source' | 'controller', namespace: string): Promise<void> {
        socket.ws.send(JSON.stringify({ type: 'register', role, namespace }))
        while (true) {
            const msg = await socket.next()
            if (msg.type === 'ready') return
            if (msg.type === 'error') throw new Error(msg.message)
        }
    }

    function makeSnapshot(label: string): SceneSnapshot {
        return {
            timestamp: new Date().toISOString(),
            version: '0.2.0',
            summary: `test ${label}`,
            meta: {
                objectCount: 1,
                bounds: {
                    min: { x: 0, y: 0, z: 0 },
                    max: { x: 1, y: 1, z: 1 },
                },
            },
            objects: [
                {
                    id: 'o1',
                    kind: 'mesh',
                    name: label,
                    description: '',
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                },
            ],
        }
    }

    it('source putSnapshot is returned by controller snapshot', async () => {
        const source = await connect(`ws://localhost:${server.port}`)
        await register(source, 'source', 'demo')
        await source.next() // discard initial empty snapshot

        const snapshot = makeSnapshot('first')
        source.ws.send(JSON.stringify({ type: 'putSnapshot', snapshot }))

        const sourceAck = await source.next()
        expect(sourceAck.type).toBe('snapshot')
        expect(sourceAck.snapshot?.summary).toBe('test first')

        const controller = await connect(`ws://localhost:${server.port}`)
        await register(controller, 'controller', 'demo')
        const controllerSnapshot = await controller.next()
        expect(controllerSnapshot.type).toBe('snapshot')
        expect(controllerSnapshot.snapshot?.summary).toBe('test first')

        source.ws.close()
        controller.ws.close()
    })

    it('subscribed controller receives change on putSnapshot', async () => {
        const controller = await connect(`ws://localhost:${server.port}`)
        await register(controller, 'controller', 'demo')
        await controller.next() // initial snapshot

        controller.ws.send(JSON.stringify({ type: 'subscribe', topics: ['snapshots'] }))
        await controller.next() // snapshot after subscribe

        const source = await connect(`ws://localhost:${server.port}`)
        await register(source, 'source', 'demo')
        await source.next() // initial snapshot

        const snapshot = makeSnapshot('second')
        source.ws.send(JSON.stringify({ type: 'putSnapshot', snapshot }))
        await source.next() // source ack

        const change = await controller.next()
        expect(change.type).toBe('change')
        expect(change.snapshot?.summary).toBe('test second')

        source.ws.close()
        controller.ws.close()
    })

    it('one-shot command is broadcast to source and subscribed controllers', async () => {
        const source = await connect(`ws://localhost:${server.port}`)
        await register(source, 'source', 'demo')
        await source.next() // initial snapshot

        const controller = await connect(`ws://localhost:${server.port}`)
        await register(controller, 'controller', 'demo')
        await controller.next() // initial snapshot
        controller.ws.send(JSON.stringify({ type: 'subscribe', topics: ['commands'] }))
        await controller.next() // snapshot after subscribe

        controller.ws.send(JSON.stringify({ type: 'command', kind: 'one-shot', payload: { action: 'focus' } }))

        const sourceMsg = await source.next()
        expect(sourceMsg.type).toBe('command')
        expect(sourceMsg.cmd?.payload).toEqual({ action: 'focus' })

        const controllerMsg = await controller.next()
        expect(controllerMsg.type).toBe('command')
        expect(controllerMsg.cmd?.payload).toEqual({ action: 'focus' })

        source.ws.close()
        controller.ws.close()
    })

    it('active command is stored and cleared', async () => {
        const source = await connect(`ws://localhost:${server.port}`)
        await register(source, 'source', 'demo')
        await source.next()

        const controller = await connect(`ws://localhost:${server.port}`)
        await register(controller, 'controller', 'demo')
        await controller.next()

        controller.ws.send(JSON.stringify({ type: 'command', kind: 'active', payload: { action: 'rotate' } }))
        const cmdMsg = await controller.next()
        expect(cmdMsg.type).toBe('command')
        const id = cmdMsg.cmd?.id
        expect(id).toBeDefined()

        // Source also receives the command broadcast.
        const sourceCmd = await source.next()
        expect(sourceCmd.type).toBe('command')

        controller.ws.send(JSON.stringify({ type: 'snapshot' }))
        const snapshot = await controller.next()
        expect(snapshot.type).toBe('snapshot')
        expect(snapshot.activeCommands).toHaveLength(1)

        controller.ws.send(JSON.stringify({ type: 'clearCommand', id }))
        const cleared = await source.next()
        expect(cleared.type).toBe('commandCleared')
        expect(cleared.id).toBe(id)

        controller.ws.send(JSON.stringify({ type: 'snapshot' }))
        const snapshot2 = await controller.next()
        expect(snapshot2.activeCommands).toHaveLength(0)

        source.ws.close()
        controller.ws.close()
    })

    it('namespaces are isolated', async () => {
        const sourceA = await connect(`ws://localhost:${server.port}`)
        await register(sourceA, 'source', 'a')
        await sourceA.next()
        sourceA.ws.send(JSON.stringify({ type: 'putSnapshot', snapshot: makeSnapshot('a') }))
        await sourceA.next()

        const sourceB = await connect(`ws://localhost:${server.port}`)
        await register(sourceB, 'source', 'b')
        await sourceB.next()
        sourceB.ws.send(JSON.stringify({ type: 'putSnapshot', snapshot: makeSnapshot('b') }))
        await sourceB.next()

        const controllerA = await connect(`ws://localhost:${server.port}`)
        await register(controllerA, 'controller', 'a')
        const snapA = await controllerA.next()
        expect(snapA.snapshot?.summary).toBe('test a')

        sourceA.ws.close()
        sourceB.ws.close()
        controllerA.ws.close()
    })
})
