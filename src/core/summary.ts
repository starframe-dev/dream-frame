/**
 * Построитель текстового summary сцены (русский язык).
 *
 * Формат:
 *   "Сцена v{version}: {N} объектов, границы от ({min}) до ({max}). Состав: {breakdown}."
 *
 * Breakdown — список "{count} {plural}" по всем kind-ам в порядке убывания count.
 * Plural-формы берутся из description.KIND_PLURALS.
 */

import type { Bounds, ObjectKind, SceneSnapshot } from './types.js'
import { KIND_PLURALS, pluralRu } from './description.js'

export interface SummaryParts {
    version: string
    count: number
    bounds: Bounds
    counts: Array<[ObjectKind, number]>
}

export function buildSummaryParts(snapshot: SceneSnapshot): SummaryParts {
    const counts = new Map<ObjectKind, number>()
    for (const obj of snapshot.objects) {
        counts.set(obj.kind, (counts.get(obj.kind) ?? 0) + 1)
    }
    const ordered: Array<[ObjectKind, number]> = Array.from(counts.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return a[0].localeCompare(b[0])
    })

    return {
        version: snapshot.version,
        count: snapshot.objects.length,
        bounds: snapshot.meta.bounds,
        counts: ordered,
    }
}

export function buildSummary(snapshot: SceneSnapshot): string {
    const parts = buildSummaryParts(snapshot)
    const versionsStr = parts.version
    const countStr = pluralRu(parts.count, ['объект', 'объекта', 'объектов'])

    const boundsStr = `границы от (${fmtVec(parts.bounds.min)}) до (${fmtVec(parts.bounds.max)})`

    let breakdownStr = ''
    if (parts.counts.length > 0) {
        const items = parts.counts.map(([kind, count]) => {
            const word = pluralRu(count, KIND_PLURALS[kind])
            return `${count} ${word}`
        })
        breakdownStr = ` Состав: ${items.join(', ')}.`
    }

    return `Сцена v${versionsStr}: ${parts.count} ${countStr}, ${boundsStr}.${breakdownStr}`
}

function fmtVec(v: { x: number; y: number; z: number }): string {
    const f = (n: number) => Number.isFinite(n) ? n.toFixed(2) : '0'
    return `${f(v.x)}, ${f(v.y)}, ${f(v.z)}`
}
