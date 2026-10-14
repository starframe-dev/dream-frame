import { describe, it, expect } from 'vitest'
import { buildSummary } from '../src/core/summary.js'
import type { Bounds, SceneObject, SceneSnapshot } from '../src/core/types.js'

function makeSnapshot(objects: SceneObject[], bounds: Bounds): SceneSnapshot {
    return {
        timestamp: '2026-06-11T19:45:00.000Z',
        version: '0.1.0',
        meta: {
            objectCount: objects.length,
            bounds,
        },
        summary: '',
        objects,
    }
}

describe('buildSummary', () => {
    it('summarizes empty scene', () => {
        const s = makeSnapshot([], {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
        })
        const summary = buildSummary(s)
        expect(summary).toMatch(/Сцена v0\.1\.0: 0 объектов/)
    })

    it('summarizes scene with counts and breakdown', () => {
        const objects: SceneObject[] = [
            { id: 'p1', kind: 'player', name: 'Alice', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, size: { x: 1, y: 2, z: 1 }, bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }, description: '' },
            { id: 't1', kind: 'terrain', name: 'Ground', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, size: { x: 100, y: 0, z: 100 }, bounds: { min: { x: -50, y: 0, z: -50 }, max: { x: 50, y: 0, z: 50 } }, description: '' },
            { id: 'o1', kind: 'obstacle', name: 'Wall', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, size: { x: 2, y: 1, z: 2 }, bounds: { min: { x: -1, y: -0.5, z: -1 }, max: { x: 1, y: 0.5, z: 1 } }, description: '' },
            { id: 'o2', kind: 'obstacle', name: 'Box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, size: { x: 2, y: 1, z: 2 }, bounds: { min: { x: -1, y: -0.5, z: -1 }, max: { x: 1, y: 0.5, z: 1 } }, description: '' },
        ]
        const s = makeSnapshot(objects, {
            min: { x: -50, y: 0, z: -50 },
            max: { x: 50, y: 10, z: 50 },
        })
        const summary = buildSummary(s)
        expect(summary).toMatch(/Сцена v0\.1\.0: 4 объекта/)
        expect(summary).toMatch(/1 игрок/)
        expect(summary).toMatch(/1 террейн/)
        expect(summary).toMatch(/2 препятствия/)
        expect(summary).toMatch(/границы от \(-50\.00, 0\.00, -50\.00\) до \(50\.00, 10\.00, 50\.00\)/)
    })
})
