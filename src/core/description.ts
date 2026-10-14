/**
 * Построитель текстового описания объекта сцены (русский язык).
 *
 * Содержит чистые функции-хелперы:
 *   - colorToRussian(hex)
 *   - rotationToCompass(yRad)
 *   - geometryToString(geometry)
 *   - pluralRu(n, forms)
 *   - describeObject(object, opts)
 *
 * Все функции детерминированы и не зависят от Three.js — удобно тестировать.
 */

import type { GeometryInfo, ObjectKind, LightSubKind, SceneObject } from './types.js'

export const KIND_PLURALS: Record<ObjectKind, [string, string, string]> = {
    player: ['игрок', 'игрока', 'игроков'],
    terrain: ['террейн', 'террейна', 'террейнов'],
    obstacle: ['препятствие', 'препятствия', 'препятствий'],
    light: ['свет', 'света', 'светов'],
    camera: ['камера', 'камеры', 'камер'],
    helper: ['хелпер', 'хелпера', 'хелперов'],
    mesh: ['меш', 'меша', 'мешей'],
    group: ['группа', 'группы', 'групп'],
}

const KIND_LABEL_RU: Record<ObjectKind, string> = {
    player: 'игрок',
    terrain: 'террейн',
    obstacle: 'препятствие',
    light: 'свет',
    camera: 'камера',
    helper: 'хелпер',
    mesh: 'меш',
    group: 'группа',
}

const LIGHT_SUBKIND_RU: Record<LightSubKind, string> = {
    directional: 'направленный',
    point: 'точечный',
    ambient: 'фоновый',
    spot: 'прожектор',
    unknown: '',
}

/**
 * Русское прилагательное цвета из hex.
 * Возвращает `undefined`, если цвет не похож ни на одну базовую окраску.
 */
export function colorToRussian(hex: string | undefined): string | undefined {
    if (!hex) return undefined
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
    if (!m) return undefined
    const c = m[1]
    const r = parseInt(c.slice(0, 2), 16) / 255
    const g = parseInt(c.slice(2, 4), 16) / 255
    const b = parseInt(c.slice(4, 6), 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const v = max
    const s = max === 0 ? 0 : d / max

    if (s < 0.15) {
        if (v < 0.25) return 'чёрный'
        if (v > 0.85) return 'белый'
        return 'серый'
    }

    let h = 0
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
        else if (max === g) h = ((b - r) / d + 2) * 60
        else h = ((r - g) / d + 4) * 60
    }

    if (h < 15 || h >= 345) return 'красный'
    if (h < 45) return 'оранжевый'
    if (h < 70) return 'жёлтый'
    if (h < 165) return 'зелёный'
    if (h < 200) return 'голубой'
    if (h < 260) return 'синий'
    if (h < 310) return 'фиолетовый'
    return 'магента'
}

const COMPASS = [
    'север',
    'северо-восток',
    'восток',
    'юго-восток',
    'юг',
    'юго-запад',
    'запад',
    'северо-запад',
]

/**
 * rotation.y в радианах → одно из 8 направлений (север, северо-восток, ...).
 * rotation.y = 0 → "север".
 */
export function rotationToCompass(yRad: number): string {
    const step = Math.PI / 4
    const raw = Math.round(yRad / step)
    const idx = ((raw % 8) + 8) % 8
    return COMPASS[idx]
}

/**
 * "бокс (2×1×3)" / "капсула (r=0.3, h=1.2)" / и т.п.
 * Возвращает пустую строку для custom-геометрии.
 */
export function geometryToString(geometry: GeometryInfo | undefined): string {
    if (!geometry) return ''
    switch (geometry.type) {
        case 'box':
        case 'plane':
            return geometry.size
                ? `${geometryLabel(geometry.type)} (${fmtNum(geometry.size.x)}×${fmtNum(geometry.size.z || geometry.size.y)})`
                : geometryLabel(geometry.type)
        case 'sphere':
        case 'ring':
            return geometry.radius !== undefined
                ? `${geometryLabel(geometry.type)} (r=${fmtNum(geometry.radius)})`
                : geometryLabel(geometry.type)
        case 'cylinder':
        case 'cone':
        case 'capsule':
            return geometry.radius !== undefined
                ? `${geometryLabel(geometry.type)} (r=${fmtNum(geometry.radius)}${geometry.height !== undefined ? `, h=${fmtNum(geometry.height)}` : ''})`
                : geometryLabel(geometry.type)
        case 'custom':
            return ''
    }
}

function geometryLabel(type: GeometryInfo['type']): string {
    switch (type) {
        case 'box': return 'бокс'
        case 'sphere': return 'сфера'
        case 'cylinder': return 'цилиндр'
        case 'capsule': return 'капсула'
        case 'plane': return 'плоскость'
        case 'cone': return 'конус'
        case 'ring': return 'кольцо'
        case 'custom': return ''
    }
}

function fmtNum(n: number): string {
    if (!Number.isFinite(n)) return '0'
    return n.toFixed(2).replace(/\.?0+$/, '') || '0'
}

/**
 * Русские plural-формы для чисел.
 * forms = [одна форма (`1 игрок`), две-четыре формы (`2 игрока`), пять+ (`5 игроков`)].
 *
 * Учитывает склонения 11..14 как "много" (`11 игроков`),
 * а также 1 как "одна форма" и любые другие остатки — как "много".
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
    const abs = Math.abs(Math.trunc(n))
    const lastTwo = abs % 100
    if (lastTwo >= 11 && lastTwo <= 14) return forms[2]
    const last = abs % 10
    if (last === 1) return forms[0]
    if (last >= 2 && last <= 4) return forms[1]
    return forms[2]
}

export interface DescriptionContext {
    kind: ObjectKind
    lightSubKind?: LightSubKind
}

/**
 * Сформировать текстовое описание объекта.
 *
 * Шаблон:
 *   {colorAdj} {geometry}, kind: {kind}, "{name}" в позиции (x, y, z),
 *   повёрнут на rx°/ry°/rz°, масштаб (sx, sy, sz). {kindTail}
 */
export function describeObject(obj: SceneObject, ctx: DescriptionContext): string {
    const parts: string[] = []

    // 1. визуальный блок: цвет + геометрия
    const color = colorToRussian(obj.visual?.color)
    const geometry = geometryToString(obj.geometry)

    let visualBlock = ''
    if (color && geometry) visualBlock = `${color} ${geometry}`
    else if (color) visualBlock = color
    else if (geometry) visualBlock = geometry

    // 2. kind
    let kindRu = KIND_LABEL_RU[ctx.kind]
    if (ctx.kind === 'light' && ctx.lightSubKind && LIGHT_SUBKIND_RU[ctx.lightSubKind]) {
        kindRu = `${LIGHT_SUBKIND_RU[ctx.lightSubKind]} ${kindRu}`
    }

    // 3. сборка
    if (visualBlock) {
        parts.push(`${visualBlock} ${kindRu}, kind: ${ctx.kind}, "${obj.name}"`)
    } else {
        parts.push(`${kindRu}, kind: ${ctx.kind}, "${obj.name}"`)
    }

    parts.push(`в позиции (${fmtNum(obj.position.x)}, ${fmtNum(obj.position.y)}, ${fmtNum(obj.position.z)})`)
    parts.push(
        `повёрнут на ${fmtNum(deg(obj.rotation.x))}°/${fmtNum(deg(obj.rotation.y))}°/${fmtNum(deg(obj.rotation.z))}°`
    )
    parts.push(
        `масштаб (${fmtNum(obj.scale.x)}, ${fmtNum(obj.scale.y)}, ${fmtNum(obj.scale.z)})`
    )

    let tail = ''
    switch (ctx.kind) {
        case 'player':
            tail = `Смотрит на ${rotationToCompass(obj.rotation.y)}`
            break
        case 'terrain':
        case 'obstacle': {
            const bits: string[] = []
            if (obj.visual?.castShadow) bits.push('отбрасывает тень')
            if (obj.visual?.receiveShadow) bits.push('принимает тень')
            tail = bits.length ? bits.join(', ') : ''
            break
        }
        case 'light': {
            const intensity = obj.props?.intensity
            const lightColor = obj.props?.color
            const intensityStr = typeof intensity === 'number' ? fmtNum(intensity) : '?'
            const colorStr = typeof lightColor === 'string' ? lightColor : '#ffffff'
            tail = `Интенсивность ${intensityStr}, цвет ${colorStr}`
            break
        }
        case 'camera': {
            const fov = obj.props?.fov
            const near = obj.props?.near
            const far = obj.props?.far
            tail = `FOV ${typeof fov === 'number' ? fmtNum(fov) : '?'}°, near ${typeof near === 'number' ? fmtNum(near) : '?'}, far ${typeof far === 'number' ? fmtNum(far) : '?'}`
            break
        }
        case 'helper':
            tail = 'Вспомогательный объект'
            break
    }

    let result = parts.join(', ')
    if (tail) result += `. ${tail}`
    return result + '.'
}

function deg(rad: number): number {
    return (rad * 180) / Math.PI
}
