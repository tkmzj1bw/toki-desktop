import { writeFileSync } from 'node:fs'

const layer = (id, visible = true) => ({ id, name: id, color: '#171719', visible, locked: false })
const doc = (shapes = [], layers = [layer('l1')], bed = { width: 300, height: 300 }) => ({
  shapes,
  layers,
  bed,
  settings: { feedRate: 1800, travelRate: 3000, penUp: 5, penDown: 0, passes: 1 },
})
const shape = (id, type, layerId, points) => ({ id, type, layerId, points, stroke: '#171719', width: 0.5 })
const rect = shape('s1', 'rect', 'l1', [{ x: 70, y: 70 }, { x: 230, y: 230 }])
const ellipse = shape('s2', 'ellipse', 'l1', [{ x: 100, y: 100 }, { x: 200, y: 200 }])
const poly = shape('s3', 'polyline', 'l2', [
  { x: 70, y: 150 }, { x: 150, y: 70 }, { x: 230, y: 150 }, { x: 150, y: 230 }, { x: 70, y: 150 },
])
const demo = doc([rect, ellipse, poly], [layer('l1'), layer('l2')])
const hidden = doc([rect, ellipse, poly], [layer('l1'), layer('l2', false)])
const outOfBed = doc([
  shape('s4', 'line', 'l1', [{ x: -20, y: 10 }, { x: 350, y: 320 }]),
], [layer('l1')], { width: 300, height: 200 })
const incomplete = doc([shape('s5', 'line', 'l1', [{ x: 10, y: 10 }])])

const tool = (kind, extra) => ({
  kind, label: kind, safeZ: kind === 'pen' ? 5 : kind === 'hotend' ? 10 : 15,
  workZ: kind === 'hotend' ? 0.2 : 0, rpmMin: 0, rpmMax: 12000, rpmDefault: 8000,
  nozzleTempMax: 260, bedTempMax: 110, nozzleTarget: 200, bedTarget: 60,
  spindleEnabled: kind === 'spindle', ...extra,
})
const profile = (label, kind, maxZ, feedRateMax, travelRateMax, safeZ, workZ, extra = {}) => ({
  label, bed: { width: 300, height: 300, maxZ }, feedRateMax, travelRateMax,
  tool: tool(kind, { safeZ, workZ, ...extra }),
})
const profiles = {
  plotter: profile('PEN PLOTTER', 'pen', 40, 6000, 9000, 5, 0),
  printer3d: profile('IMPRESSORA 3D', 'hotend', 300, 12000, 18000, 10, 0.2),
  cnc: profile('CNC / FUSO', 'spindle', 120, 3000, 6000, 15, 0),
}
const rig = (mode, acknowledged = {}, overrides = {}) => ({
  mode,
  profiles: {
    ...profiles,
    [mode]: { ...profiles[mode], ...overrides },
  },
  acknowledged: {
    spindleFirmware: false, enclosure: false, workholding: false, thermalRunaway: false,
    ...acknowledged,
  },
  lastModeSwitchAt: null,
})

const cases = []
const add = (fn, args) => cases.push({ fn, args })

for (const args of [
  [2.5], [-2.5], [1.2345, 3], [1.23456, 3], [0.0005, 3], [-0.0005, 3], [1234.5678, 2],
]) add('round', args)

add('clampToBed', [{ x: 350, y: -10 }, doc()])
add('clampToBed', [{ x: 150.12345, y: 299.999 }, doc([], [layer('l1')], { width: 300, height: 200 })])

for (const s of [
  shape('l', 'line', 'l1', [{ x: 1.25, y: 2.5 }, { x: 3.75, y: 4.5 }]),
  shape('r', 'rect', 'l1', [{ x: 230, y: 230 }, { x: 70, y: 70 }]),
  shape('e', 'ellipse', 'l1', [{ x: 100, y: 100 }, { x: 200, y: 200 }]),
  shape('p', 'polyline', 'l1', [{ x: 0, y: 0 }, { x: 10, y: 20 }]),
  shape('x', 'line', 'l1', [{ x: 1, y: 1 }]),
  shape('u', 'unknown', 'l1', [{ x: 1, y: 1 }, { x: 2, y: 2 }]),
]) add('shapeToPoints', [s, doc()])

add('buildSegments', [doc()])
add('buildSegments', [demo])
add('buildSegments', [hidden])
add('buildSegments', [incomplete])
add('buildSegments', [outOfBed])

add('toGcode', [doc(), null])
add('toGcode', [demo, null])
add('toGcode', [doc(), rig('plotter')])
add('toGcode', [demo, rig('plotter')])
add('toGcode', [demo, rig('printer3d')])
add('toGcode', [demo, rig('printer3d', { thermalRunaway: true })])
add('toGcode', [demo, rig('cnc')])
add('toGcode', [demo, rig('cnc', { spindleFirmware: true, enclosure: true, workholding: true })])
add('toGcode', [outOfBed, rig('plotter')])
add('toGcode', [hidden, rig('plotter')])
add('toGcode', [incomplete, rig('plotter')])
add('toGcode', [demo, rig('plotter', {}, { feedRateMax: 1200, travelRateMax: 1500 })])

writeFileSync('scripts/rust-inputs.jsonl', cases.map(c => JSON.stringify(c)).join('\n') + '\n')
console.log(`wrote ${cases.length} cases`)
