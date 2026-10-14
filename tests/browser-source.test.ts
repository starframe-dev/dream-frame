import { describe, it, expect, beforeEach } from 'vitest'
import { DreamFrameSource } from '../src/client/source.js'
import type { SceneSnapshot } from '../src/core/types.js'

class MockWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly url: string
    readyState = MockWebSocket.CONNECTING
    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onclose: ((ev: CloseEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null

    sent: string[] = []
    static last: MockWebSocket | null = null

    constructor(url: string) {
        this.url = url
        MockWebSocket.last = this
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.({} as Event)
        }, 0)
    }

    send(data: string): void {
        this.sent.push(data)
    }

    close(): void {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.({} as CloseEvent)
    }
}

function makeSnapshot(): SceneSnapshot {
    return {
        timestamp: new Date().toISOString(),
        version: '0.2.0',
        summary: 'mock snapshot',
        meta: {
            objectCount: 0,
            bounds: {
                min: { x: 0, y: 0, z: 0 },
                max: { x: 0, y: 0, z: 0 },
            },
        },
        objects: [],
    }
}

describe('DreamFrameSource', () => {
    beforeEach(() => {
        MockWebSocket.last = null
    })

    it('connects and registers as source', async () => {
        const source = new DreamFrameSource({ namespace: 'demo', WebSocket: MockWebSocket })
        const connectPromise = source.connect('ws://localhost:1234')
        await new Promise((resolve) => setTimeout(resolve, 10))
        const socket = MockWebSocket.last
        expect(socket).not.toBeNull()
        expect(socket?.sent.length).toBe(1)
        expect(JSON.parse(socket!.sent[0])).toEqual({
            type: 'register',
            role: 'source',
            namespace: 'demo',
        })

        socket!.onmessage?.({ data: JSON.stringify({ type: 'ready', namespace: 'demo', role: 'source' }) } as MessageEvent)
        await connectPromise
    })

    it('publishes snapshot after registration', async () => {
        const source = new DreamFrameSource({ namespace: 'demo', WebSocket: MockWebSocket })
        const connectPromise = source.connect('ws://localhost:1234')
        await new Promise((resolve) => setTimeout(resolve, 10))
        const socket = MockWebSocket.last!

        socket.onmessage?.({ data: JSON.stringify({ type: 'ready', namespace: 'demo', role: 'source' }) } as MessageEvent)
        await connectPromise

        await source.putSnapshot(makeSnapshot())
        expect(socket.sent.length).toBe(2)
        const second = JSON.parse(socket.sent[1])
        expect(second.type).toBe('putSnapshot')
        expect(second.snapshot.summary).toBe('mock snapshot')
    })

    it('notifies command handlers', async () => {
        const source = new DreamFrameSource({ namespace: 'demo', WebSocket: MockWebSocket })
        const connectPromise = source.connect('ws://localhost:1234')
        await new Promise((resolve) => setTimeout(resolve, 10))
        const socket = MockWebSocket.last!

        let receivedCommand: Record<string, unknown> | null = null
        source.onCommand((cmd) => {
            receivedCommand = cmd as unknown as Record<string, unknown>
        })

        socket.onmessage?.({ data: JSON.stringify({ type: 'ready', namespace: 'demo', role: 'source' }) } as MessageEvent)
        await connectPromise

        socket.onmessage?.({
            data: JSON.stringify({
                type: 'command',
                cmd: { id: 'c1', kind: 'one-shot', payload: { action: 'focus' }, issuedAt: '2026-01-01T00:00:00.000Z' },
            }),
        } as MessageEvent)

        expect(receivedCommand).not.toBeNull()
        expect(receivedCommand?.payload).toEqual({ action: 'focus' })
    })
})
