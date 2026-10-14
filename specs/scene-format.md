# DreamFrame — формат сцены для LLM

## Цель

Преобразовать Three.js сцену в структурированный JSON, который LLM может анализировать и понимать пространственное состояние мира. JSON содержит и структурированные данные (координаты, геометрию, визуальные свойства), и человекочитаемые **русские описания**, которые задаёт разработчик при интеграции DreamFrame.

## Формат JSON (`SceneSnapshot`)

```typescript
interface SceneSnapshot {
    /** Время создания снапшота (ISO 8601) */
    timestamp: string

    /** Версия формата */
    version: string

    /** Краткое текстовое описание сцены на русском (генерируется автоматически) */
    summary: string

    /** Мета-информация о сцене */
    meta: {
        /** Количество объектов */
        objectCount: number
        /** Размеры мирового пространства (bounding box) */
        bounds: { min: Vec3; max: Vec3 }
    }

    /** Список всех значимых объектов */
    objects: SceneObject[]
}

interface Vec3 {
    x: number
    y: number
    z: number
}

interface SceneObject {
    /** Уникальный идентификатор (uuid Three.js или кастомный) */
    id: string

    /** Семантический тип объекта */
    kind: 'player' | 'terrain' | 'obstacle' | 'light' | 'camera' | 'helper' | 'mesh' | 'group'

    /** Подтип для источников света */
    lightSubKind?: 'directional' | 'point' | 'ambient' | 'spot' | 'unknown'

    /** Человекочитаемое имя */
    name: string

    /** Описание объекта на русском, заданное разработчиком */
    description: string

    /** Позиция в мировых координатах */
    position: Vec3

    /** Поворот (Euler angles в радианах) */
    rotation: Vec3

    /** Масштаб */
    scale: Vec3

    /** Размер объекта в мировых координатах (axis-aligned bounding box) */
    size: Vec3

    /** Границы объекта в мировых координатах */
    bounds: { min: Vec3; max: Vec3 }

    /** Визуальные свойства */
    visual?: {
        /** Цвет в hex */
        color?: string
        /** Прозрачность 0..1 */
        opacity?: number
        /** Отбрасывает тень */
        castShadow?: boolean
        /** Принимает тень */
        receiveShadow?: boolean
    }

    /** Геометрия (для примитивов) */
    geometry?: {
        type: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'cone' | 'ring' | 'custom'
        /** Размеры в локальных единицах */
        size?: Vec3
        /** Радиус (для сферы, цилиндра, кольца) */
        radius?: number
        /** Высота (для цилиндра, конуса, капсулы) */
        height?: number
    }

    /** Отношения с другими объектами */
    relations?: {
        /** ID родительского объекта */
        parent?: string
        /** ID дочерних объектов */
        children?: string[]
    }

    /** Дополнительные свойства (зависит от kind) */
    props?: Record<string, unknown>
}
```

## Текстовые описания

`description` — это строка, которую **разработчик задаёт самостоятельно** при интеграции. Два способа:

1. Через `userData` объекта Three.js:
```ts
const player = new THREE.Mesh(geometry, material)
player.name = 'Alice'
player.userData.description = 'Игрок Алиса стоит у входа, готова идти к цели.'
```

2. Через `descriptionResolver` в опциях `serializeScene`:
```ts
serializeScene(scene, {
    descriptionResolver: (obj) => {
        if (obj.name === 'Alice') return 'Игрок Алиса.'
        return undefined
    }
})
```

Приоритет: `obj.userData.description` > `descriptionResolver(...)` > пустая строка.

DreamFrame также экспортирует утилиту `describeObject()`, которая может помочь сгенерировать черновик описания из структурированных данных сцены (цвет, геометрия, kind, position, rotation, scale и kind-специфичные детали). Использование этой утилиты — на усмотрение разработчика.

Сцена в целом получает поле `summary` — строку с числом объектов, границами и разбивкой по kind с русскими plural-формами:
```json
"Сцена v0.1.0: 8 объектов, границы от (-50.00, 0.00, -50.00) до (50.00, 10.00, 50.00). Состав: 1 игрок, 1 террейн, 4 препятствия, 2 света."
```

## Правила фильтрации

Не включаем:
- Внутренние объекты Three.js (WebGLRenderer, материалы как отдельные сущности)
- Empty группы без визуального представления
- Вспомогательные объекты размером < 0.01

Включаем:
- Все Mesh с видимой геометрией
- Источники света (позиция, тип, цвет, интенсивность)
- Камеру (позиция, FOV, near/far)
- Помощники (GridHelper, AxesHelper) — как `kind: 'helper'`

## Пример выхода

```json
{
    "timestamp": "2026-06-11T19:45:00.000Z",
    "version": "0.1.0",
    "summary": "Сцена v0.1.0: 5 объектов, границы от (-50.00, 0.00, -50.00) до (50.00, 10.00, 50.00). Состав: 1 игрок, 1 террейн, 2 препятствия, 1 свет.",
    "meta": {
        "objectCount": 5,
        "bounds": {
            "min": { "x": -50, "y": 0, "z": -50 },
            "max": { "x": 50, "y": 10, "z": 50 }
        }
    },
    "objects": [
        {
            "id": "terrain-01",
            "kind": "terrain",
            "name": "Ground Plane",
            "description": "Большая тёмно-зелёная плоскость — земля под всей сценой.",
            "position": { "x": 0, "y": 0, "z": 0 },
            "rotation": { "x": -1.57, "y": 0, "z": 0 },
            "scale": { "x": 1, "y": 1, "z": 1 },
            "visual": { "color": "#3a4a3a", "receiveShadow": true },
            "geometry": { "type": "plane", "size": { "x": 100, "y": 0, "z": 100 } }
        },
        {
            "id": "player-alice",
            "kind": "player",
            "name": "Alice",
            "description": "Игрок Алиса стоит у входа, повёрнута на северо-восток, готова идти к цели.",
            "position": { "x": 2.5, "y": 0, "z": -3.0 },
            "rotation": { "x": 0, "y": 0.78, "z": 0 },
            "scale": { "x": 1, "y": 1, "z": 1 },
            "size": { "x": 0.6, "y": 1.8, "z": 0.6 },
            "bounds": {
                "min": { "x": 2.2, "y": 0, "z": -3.3 },
                "max": { "x": 2.8, "y": 1.8, "z": -2.7 }
            },
            "visual": { "color": "#ff33ff", "castShadow": true },
            "geometry": { "type": "capsule", "radius": 0.3, "height": 1.2 },
            "props": { "speed": 8, "target": { "x": 10, "z": 10 } }
        }
    ]
}
```
