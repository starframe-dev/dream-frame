import { describe, it, expect } from 'vitest'
import {
    colorToRussian,
    rotationToCompass,
    geometryToString,
    pluralRu,
    describeObject,
    KIND_PLURALS,
} from '../src/core/description.js'
import type { SceneObject } from '../src/core/types.js'

describe('colorToRussian', () => {
    it('detects red', () => {
        expect(colorToRussian('#ff0000')).toBe('красный')
    })

    it('detects green', () => {
        expect(colorToRussian('#00ff00')).toBe('зелёный')
    })

    it('detects blue', () => {
        expect(colorToRussian('#0000ff')).toBe('синий')
    })

    it('detects gray', () => {
        expect(colorToRussian('#808080')).toBe('серый')
    })

    it('returns undefined for invalid/empty input', () => {
        expect(colorToRussian(undefined)).toBeUndefined()
        expect(colorToRussian('nope')).toBeUndefined()
    })
})

describe('rotationToCompass', () => {
    it('maps 0 to север', () => {
        expect(rotationToCompass(0)).toBe('север')
    })

    it('maps PI/4 to северо-восток', () => {
        expect(rotationToCompass(Math.PI / 4)).toBe('северо-восток')
    })

    it('wraps large angles', () => {
        expect(rotationToCompass(2 * Math.PI)).toBe('север')
        expect(rotationToCompass(-Math.PI / 2)).toBe('запад')
    })
})

describe('geometryToString', () => {
    it('renders box dimensions', () => {
        expect(
            geometryToString({ type: 'box', size: { x: 2, y: 1, z: 3 } })
        ).toBe('бокс (2×3)')
    })

    it('renders sphere radius', () => {
        expect(geometryToString({ type: 'sphere', radius: 1 })).toBe('сфера (r=1)')
    })

    it('renders capsule radius and height', () => {
        expect(
            geometryToString({ type: 'capsule', radius: 0.3, height: 1.2 })
        ).toBe('капсула (r=0.3, h=1.2)')
    })

    it('returns empty string for custom geometry', () => {
        expect(geometryToString({ type: 'custom' })).toBe('')
    })
})

describe('pluralRu', () => {
    it('uses singular for 1', () => {
        expect(pluralRu(1, KIND_PLURALS.player)).toBe('игрок')
    })

    it('uses genitive singular for 2-4', () => {
        expect(pluralRu(3, KIND_PLURALS.player)).toBe('игрока')
    })

    it('uses genitive plural for 5-20', () => {
        expect(pluralRu(11, KIND_PLURALS.player)).toBe('игроков')
    })

    it('uses singular for 21', () => {
        expect(pluralRu(21, KIND_PLURALS.player)).toBe('игрок')
    })
})

describe('describeObject', () => {
    it('describes a player with facing direction', () => {
        const obj: SceneObject = {
            id: 'p1',
            kind: 'player',
            name: 'Alice',
            position: { x: 2.5, y: 0, z: -3 },
            rotation: { x: 0, y: Math.PI / 4, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            size: { x: 0.6, y: 1.8, z: 0.6 },
            bounds: { min: { x: 2.2, y: 0, z: -3.3 }, max: { x: 2.8, y: 1.8, z: -2.7 } },
            description: '',
            visual: { color: '#ff00ff' },
            geometry: { type: 'capsule', radius: 0.3, height: 1.2 },
            props: { speed: 8 },
        }
        const desc = describeObject(obj, { kind: 'player' })
        expect(desc).toMatch(/Alice/)
        expect(desc).toMatch(/player/)
        expect(desc).toMatch(/Смотрит на северо-восток/)
        expect(desc).toMatch(/2\.5/)
        expect(desc).toMatch(/-3/)
    })

    it('describes a light with intensity and color', () => {
        const obj: SceneObject = {
            id: 'l1',
            kind: 'light',
            name: 'Sun',
            position: { x: 10, y: 20, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            size: { x: 0, y: 0, z: 0 },
            bounds: { min: { x: 10, y: 20, z: 0 }, max: { x: 10, y: 20, z: 0 } },
            description: '',
            props: { intensity: 1.5, color: '#ffffff' },
            lightSubKind: 'directional',
        }
        const desc = describeObject(obj, { kind: 'light', lightSubKind: 'directional' })
        expect(desc).toMatch(/направленный свет/)
        expect(desc).toMatch(/Интенсивность 1\.5/)
        expect(desc).toMatch(/цвет #ffffff/)
    })

    it('describes an obstacle with shadow flags', () => {
        const obj: SceneObject = {
            id: 'o1',
            kind: 'obstacle',
            name: 'Wall',
            position: { x: 5, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            size: { x: 2, y: 1, z: 3 },
            bounds: { min: { x: 4, y: -0.5, z: -1.5 }, max: { x: 6, y: 0.5, z: 1.5 } },
            description: '',
            visual: { color: '#00ff00', castShadow: true },
            geometry: { type: 'box', size: { x: 2, y: 1, z: 3 } },
        }
        const desc = describeObject(obj, { kind: 'obstacle' })
        expect(desc).toMatch(/отбрасывает тень/)
    })
})
