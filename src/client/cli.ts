#!/usr/bin/env node
import WebSocket from 'ws'
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { StateServer, statePath } from '../server/index.js'
import { DreamFrameSource } from './source.js'
import { DreamFrameController } from './controller.js'
import type { Screenshot } from '../core/types.js'
import type { SceneSnapshot } from '../core/types.js'
import type { WebSocketCtorLike } from './source.js'

const STATE_DIR = '/tmp'

// === Subcommand dispatch ===

const subcommand = process.argv[2]
switch (subcommand) {
    case 'server':
        runServer().catch(fatal)
        break
    case 'source':
        runSource().catch(fatal)
        break
    case 'controller':
        runController().catch(fatal)
        break
    case 'screenshot':
        runScreenshot().catch(fatal)
        break
    case '--help':
    case '-h':
    case undefined:
        printHelp()
        break
    default:
        console.error(`Unknown subcommand: ${subcommand}`)
        printHelp()
        process.exit(1)
}

// === server ===

async function runServer(): Promise<void> {
    const opts = parseServerOpts()
    const server = await StateServer.create({ port: opts.port, slug: opts.slug })
    console.log(`[server] up on ws://localhost:${server.port}`)

    const shutdown = async () => {
        console.log('\n[server] shutting down')
        await server.stop()
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

// === source ===

async function runSource(): Promise<void> {
    const opts = parseSourceOpts()
    const url = resolveUrl(opts.slug, opts.url)
    const source = new DreamFrameSource({
        namespace: opts.namespace,
        WebSocket: WebSocket as unknown as WebSocketCtorLike,
    })
    await source.connect(url)

    const stream = opts.input
        ? createReadStream(opts.input)
        : process.stdin

    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let lineNo = 0
    for await (const line of rl) {
        lineNo++
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        try {
            const message = JSON.parse(trimmed) as Record<string, unknown>
            if (message.type === 'putSnapshot') {
                await source.putSnapshot(message.snapshot as unknown as SceneSnapshot)
            } else if (message.snapshot) {
                await source.putSnapshot(message as unknown as SceneSnapshot)
            } else {
                console.error(`[source] line ${lineNo}: expected putSnapshot or snapshot object`)
            }
        } catch (err) {
            console.error(`[source] invalid JSON on line ${lineNo}: ${errMessage(err)}`)
        }
    }

    source.close()
}

// === controller ===

async function runController(): Promise<void> {
    const opts = parseControllerOpts()
    const url = resolveUrl(opts.slug, opts.url)
    const controller = new DreamFrameController({ namespace: opts.namespace, url })
    await controller.connect()

    if (opts.interactive) {
        await runInteractive(controller)
        return
    }

    if (opts.watch) {
        await controller.subscribe(['snapshots', 'commands'])
        controller.onSnapshot((msg) => console.log(JSON.stringify(msg)))
        controller.onChange((msg) => console.log(JSON.stringify(msg)))
        controller.onCommand((msg) => console.log(JSON.stringify(msg)))
        process.on('SIGINT', () => {
            controller.close()
            process.exit(0)
        })
        return
    }

    // Default: request snapshot and print it, then exit.
    let done = false
    controller.onSnapshot((snapshot, activeCommands) => {
        if (done) return
        done = true
        console.log(JSON.stringify({ snapshot, activeCommands }, null, opts.pretty ? 2 : undefined))
        controller.close()
    })
    await controller.snapshot()

    setTimeout(() => {
        if (!done) {
            console.error('[controller] timeout waiting for snapshot')
            process.exit(1)
        }
    }, 5000)
}

async function runScreenshot(): Promise<void> {
    const opts = parseControllerOpts()
    const output = option('--out') ?? '/tmp/dream-frame-screenshot.png'
    const controller = new DreamFrameController({ namespace: opts.namespace, url: resolveUrl(opts.slug, opts.url) })
    try {
        await controller.connect()
        const screenshot = await controller.screenshot()
        writeScreenshot(output, screenshot)
        console.log(JSON.stringify({ output, mimeType: screenshot.mimeType, width: screenshot.width, height: screenshot.height }))
    } finally {
        controller.close()
    }
}

function writeScreenshot(output: string, screenshot: Screenshot): void {
    const comma = screenshot.data.indexOf(',')
    const encoded = comma >= 0 ? screenshot.data.slice(comma + 1) : screenshot.data
    writeFileSync(output, Buffer.from(encoded, 'base64'))
}

async function runInteractive(controller: DreamFrameController): Promise<void> {
    console.log(`[controller] interactive mode for namespace "${controller.namespace}"`)
    console.log('commands: snapshot, subscribe [topics], unsubscribe [topics], send <kind> <json>, hold <json>, clear <id>, quit')

    controller.onSnapshot((msg) => console.log('<', JSON.stringify(msg)))
    controller.onChange((msg) => console.log('<', JSON.stringify(msg)))
    controller.onCommand((msg) => console.log('<', JSON.stringify(msg)))

    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
    for await (const line of rl) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split(/\s+/)
        const cmd = parts[0]
        try {
            switch (cmd) {
                case 'snapshot':
                    await controller.snapshot()
                    break
                case 'subscribe':
                case 'unsubscribe': {
                    const topics = parts.slice(1) as Array<'snapshots' | 'commands'>
                    await controller[cmd](topics)
                    break
                }
                case 'send':
                case 'hold': {
                    const kind = cmd === 'send' ? 'one-shot' : 'active'
                    const payloadJson = parts.slice(1).join(' ')
                    const payload = payloadJson ? (JSON.parse(payloadJson) as Record<string, unknown>) : {}
                    await controller.command(kind, payload)
                    break
                }
                case 'clear':
                    await controller.clearCommand(parts[1] ?? '')
                    break
                case 'quit':
                case 'exit':
                    controller.close()
                    process.exit(0)
                default:
                    console.error(`[controller] unknown command: ${cmd}`)
            }
        } catch (err) {
            console.error(`[controller] error: ${errMessage(err)}`)
        }
    }
}

// === Connection helpers ===

interface BaseOpts {
    url?: string
    slug?: string
    namespace: string
}

function resolveUrl(slug?: string, url?: string): string {
    if (url) return url
    if (slug) {
        const path = statePath(slug)
        if (!existsSync(path)) {
            throw new Error(`no DreamFrame server found for slug "${slug}" (expected ${path})`)
        }
        const port = readFileSync(join(STATE_DIR, `${slug}.dream.port`), 'utf-8').trim()
        return `ws://localhost:${port}`
    }
    return 'ws://localhost:3002'
}

function flag(name: string): boolean {
    return process.argv.includes(name)
}

function option(name: string): string | undefined {
    const idx = process.argv.indexOf(name)
    if (idx === -1) return undefined
    return process.argv[idx + 1]
}

function requireNamespace(): string {
    const ns = option('--namespace') ?? option('-n')
    if (!ns) {
        throw new Error('--namespace <slug> is required')
    }
    return ns
}

interface ServerOpts { port?: number; slug?: string }

function parseServerOpts(): ServerOpts {
    const portStr = option('--port') ?? option('-p')
    return {
        port: portStr ? parseInt(portStr, 10) : undefined,
        slug: option('--namespace') ?? option('-n'),
    }
}

interface SourceOpts extends BaseOpts { input?: string }

function parseSourceOpts(): SourceOpts {
    const namespace = requireNamespace()
    return {
        namespace,
        url: option('--url'),
        slug: option('--slug') ?? namespace,
        input: option('--input') ?? option('-i'),
    }
}

interface ControllerOpts extends BaseOpts { watch: boolean; interactive: boolean; pretty: boolean }

function parseControllerOpts(): ControllerOpts {
    const namespace = requireNamespace()
    return {
        namespace,
        url: option('--url'),
        slug: option('--slug') ?? namespace,
        watch: flag('--watch') || flag('-w'),
        interactive: flag('--interactive') || flag('-i'),
        pretty: flag('--pretty') || flag('-p'),
    }
}

// === Misc ===

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function fatal(err: unknown): void {
    console.error('[dream-frame]', errMessage(err))
    process.exit(1)
}

function printHelp(): void {
    console.log(`dream-frame — WebSocket state server for Three.js scenes

Usage:
  dream-frame server   [--port N] [--namespace <slug>]
  dream-frame source   --namespace <slug> [--slug <slug>] [--url <ws>] [--input <file>]
  dream-frame controller --namespace <slug> [--watch|--interactive|--pretty]
                        [--slug <slug>] [--url <ws>]
  dream-frame screenshot --namespace <namespace> --out <file.png>
                        [--slug <slug>] [--url <ws>]

Examples:
  dream-frame server --namespace demo
  echo '{"type":"putSnapshot","snapshot":{...}}' | dream-frame source --namespace demo
  dream-frame controller --namespace demo --watch

Read commands (interactive):
  snapshot
  subscribe snapshots commands | unsubscribe snapshots
  send one-shot {"action":"focus"}
  send one-shot {"action":"screenshot"}
  hold {"action":"rotate"}
  clear <commandId>
  quit`)
}
