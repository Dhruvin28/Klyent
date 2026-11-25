import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDimension, unitsFromNotes } from '../dimensions'

const mm = (text: string, units: Parameters<typeof parseDimension>[1] = 'unknown') => {
  const r = parseDimension(text, units)
  assert.ok(r.ok, `expected "${text}" to parse, got ${JSON.stringify(r)}`)
  return r
}
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('feet and inches (plan §7.4 examples)', () => {
  close(mm(`9'-6"`).value, 2895.6)
  close(mm(`2'-0"`).value, 609.6)
  close(mm(`9' 6"`).value, 2895.6)
  close(mm(`9'6"`).value, 2895.6)
  close(mm(`10'`).value, 3048)
  close(mm(`6"`).value, 152.4)
  close(mm(`9'-6 1/2"`).value, 2895.6 + 12.7)
  close(mm(`9′-6″`).value, 2895.6)
  close(mm(`9'-6½"`).value, 2895.6 + 12.7)
  close(mm(`9 ft 6 in`).value, 2895.6)
})

test('rejects inches >= 12', () => {
  assert.equal(parseDimension(`9'-13"`).ok, false)
})

test('metric with explicit units', () => {
  close(mm('3600 mm').value, 3600)
  close(mm('360cm').value, 3600)
  close(mm('3.6m').value, 3600)
  close(mm('3,6 m').value, 3600)
})

test('unitless numbers need known drawing units', () => {
  const r = parseDimension('3600', 'unknown')
  assert.equal(r.ok, false)
  assert.equal((r as { reason: string }).reason, 'unitless_unknown_units')
  const ok = mm('3600', 'mm')
  close(ok.value, 3600)
  assert.equal(ok.unitFromContext, true)
  close(mm('3,600', 'mm').value, 3600)
  close(mm('360', 'cm').value, 3600)
})

test('sizes', () => {
  const s = mm('1800x600x2100', 'mm')
  assert.equal(s.kind, 'size')
  assert.deepEqual(s.values, [1800, 600, 2100])
  const c = mm('180 X 60 cm')
  assert.deepEqual(c.values, [1800, 600])
  const f = mm(`6'-0" x 2'-0"`)
  assert.equal(f.values!.length, 2)
  close(f.values![1], 609.6)
})

test('levels', () => {
  const a = mm('+2700', 'mm')
  assert.equal(a.kind, 'level')
  close(a.value, 2700)
  const b = mm('FCL +2.700', 'mm')
  assert.equal(b.kind, 'level')
  close(b.value, 2700)
  const c = mm(`LVL +9'-0"`)
  close(c.value, 2743.2)
  const d = mm('2400 AFFL', 'mm')
  assert.equal(d.kind, 'level')
  close(d.value, 2400)
})

test('radius, diameter, angle, scale', () => {
  assert.equal(mm('R300', 'mm').kind, 'radius')
  assert.equal(mm('Ø100 mm').kind, 'diameter')
  assert.equal(mm('45°').kind, 'angle')
  const s = mm('1:50')
  assert.equal(s.kind, 'scale')
  assert.equal(s.value, 50)
})

test('OCR confusions are repaired but flagged', () => {
  const r = mm('36O0', 'mm')
  close(r.value, 3600)
  assert.equal(r.corrected, true)
  const r2 = mm('l200', 'mm')
  close(r2.value, 1200)
  assert.equal(r2.corrected, true)
})

test('non-dimensions fail', () => {
  assert.equal(parseDimension('BEDROOM').ok, false)
  assert.equal(parseDimension('').ok, false)
})

test('units from sheet notes', () => {
  assert.equal(unitsFromNotes(['NOTE: ALL DIMENSIONS ARE IN MM']), 'mm')
  assert.equal(unitsFromNotes(['All dimensions in feet and inches']), 'ft_in')
  assert.equal(unitsFromNotes(['KITCHEN']), 'unknown')
})
