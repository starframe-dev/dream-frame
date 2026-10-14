import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { serializeScene } from '../src/core/serializer.js'

describe('serializeScene', () => {
    it('creates description and summary for a simple scene', () => {
        const scene = new THREE.Scene()

        const player = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.3, 1.2, 4, 8),
            new THREE.MeshStandardMaterial({ color: 0xff00ff })
        )
        player.name = 'Alice'
        player.position.set(2.5, 0, -3)
        player.rotation.y = Math.PI / 4
        player.castShadow = true
        player.userData.description = 'Игрок Алиса стоит у входа, повёрнута на северо-восток, готова идти к цели.'

        const terrain = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshStandardMaterial({ color: 0x3a4a3a })
        )
        terrain.name = 'Ground Plane'
        terrain.rotation.x = -Math.PI / 2
        terrain.receiveShadow = true
        terrain.userData.description = 'Большая тёмно-зелёная плоскость — земля под всей сценой.'

        const light = new THREE.DirectionalLight(0xffffff, 1.5)
        light.name = 'Sun'
        light.position.set(10, 20, 0)
        light.castShadow = true
        light.userData.description = 'Главное направленное освещение — яркое солнце с юга.'

        scene.add(terrain)
        scene.add(player)
        scene.add(light)

        const snapshot = serializeScene(scene, {
            kindResolver: (obj) => (obj.name === 'Alice' ? 'player' : undefined),
        })

        expect(snapshot.summary.length).toBeGreaterThan(0)
        expect(snapshot.summary).toMatch(/Сцена v0\.1\.0/)
        expect(snapshot.summary).toMatch(/1 игрок/)
        expect(snapshot.summary).toMatch(/1 террейн/)
        expect(snapshot.summary).toMatch(/1 свет/)

        expect(snapshot.objects.length).toBe(3)

        const playerObj = snapshot.objects.find((o) => o.kind === 'player')
        if (!playerObj) throw new Error('player object not found')
        expect(playerObj.description.length).toBeGreaterThan(0)
        expect(playerObj.description).toMatch(/Алиса/)
        expect(playerObj.description).toMatch(/северо-восток/)
        expect(playerObj.size.x).toBeGreaterThan(0)
        expect(playerObj.size.y).toBeGreaterThan(0)
        expect(playerObj.bounds.min.x).toBeLessThan(playerObj.position.x)
        expect(playerObj.bounds.max.x).toBeGreaterThan(playerObj.position.x)

        const terrainObj = snapshot.objects.find((o) => o.kind === 'terrain')
        if (!terrainObj) throw new Error('terrain object not found')
        expect(terrainObj.description).toMatch(/земля/)
        expect(terrainObj.size.x).toBe(100)
        expect(terrainObj.size.z).toBe(100)

        const lightObj = snapshot.objects.find((o) => o.kind === 'light')
        if (!lightObj) throw new Error('light object not found')
        expect(lightObj.description).toMatch(/солнце/)
        expect(lightObj.description).toMatch(/юга/)
        expect(lightObj.size).toEqual({ x: 0, y: 0, z: 0 })
    })

    it('uses descriptionResolver when userData.description is absent', () => {
        const scene = new THREE.Scene()
        const box = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        )
        box.name = 'RedBox'
        scene.add(box)

        const snapshot = serializeScene(scene, {
            descriptionResolver: (obj) => (obj.name === 'RedBox' ? 'Красный куб в центре.' : undefined),
        })

        const boxObj = snapshot.objects.find((o) => o.name === 'RedBox')
        if (!boxObj) throw new Error('box object not found')
        expect(boxObj.description).toBe('Красный куб в центре.')
    })

    it('skips helpers when includeHelpers is false', () => {
        const scene = new THREE.Scene()
        const grid = new THREE.GridHelper(50, 10)
        grid.name = 'Grid'
        scene.add(grid)

        const withoutHelpers = serializeScene(scene, { includeHelpers: false })
        const withHelpers = serializeScene(scene, { includeHelpers: true })

        expect(withoutHelpers.objects.length).toBe(0)
        expect(withHelpers.objects.length).toBe(1)
        expect(withHelpers.objects[0].kind).toBe('helper')
    })
})
