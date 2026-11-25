import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Pipette, RotateCcw, Upload, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { apiErrorMessage, visualizerApi, type MaterialInput } from '@/api/visualizer'
import { decodeForDisplay, encodePng } from '@/lib/visualizer/imageio'
import { limitSize, prepareMaterial, samplePatch } from '@/lib/visualizer/material'
import { hexToRgb, rgbToHex } from '@/lib/visualizer/color'
import {
  FINISHES,
  MATERIAL_CATEGORIES,
  TILE_LAYOUTS,
  type Finish,
  type MaterialCategory,
  type Quad,
  type RGBAImage,
  type TileLayout,
  type VizMaterial,
} from '@/lib/visualizer/types'
import { NumberField, RangeField, Segmented } from './common'

const TEXTURE_MAX_SIDE = 2048
const PHOTO_MAX_SIDE = 3200

export const LAYOUT_LABELS: Record<TileLayout, string> = {
  grid: 'Grid',
  brick50: 'Brick ½',
  brick33: 'Brick ⅓',
  stack90: 'Vertical ½',
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  material?: VizMaterial | null
  defaultKind?: 'texture' | 'paint'
  onSaved?: (m: VizMaterial) => void
}

function fullQuad(img: RGBAImage): Quad {
  return [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height },
  ]
}

export function MaterialDialog({ open, onOpenChange, material, defaultKind = 'texture', onSaved }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const editing = !!material
  const [kind, setKind] = useState<'texture' | 'paint'>(material?.kind ?? defaultKind)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<MaterialCategory>('laminate')
  const [colorHex, setColorHex] = useState('#d9cbb3')
  const [brand, setBrand] = useState('')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [finish, setFinish] = useState<Finish>('satin')
  const [widthMm, setWidthMm] = useState(600)
  const [heightMm, setHeightMm] = useState(600)
  const [delight, setDelight] = useState(0.85)
  const [seamless, setSeamless] = useState(0.12)
  const [layout, setLayout] = useState<TileLayout>('grid')
  const [groutMm, setGroutMm] = useState(2)
  const [groutColor, setGroutColor] = useState('#cfcac2')
  const [variation, setVariation] = useState(true)
  const [photo, setPhoto] = useState<RGBAImage | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoScale, setPhotoScale] = useState(1) // stored corners are in original-photo pixels
  const [corners, setCorners] = useState<Quad | null>(null)
  const [preparedPreview, setPreparedPreview] = useState<RGBAImage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [prepChanged, setPrepChanged] = useState(false)
  const [whiteBalance, setWhiteBalance] = useState<[number, number, number] | null>(null)
  const [pickingWhite, setPickingWhite] = useState(false)
  const [seamlessMode, setSeamlessMode] = useState<'blend' | 'cut'>('cut')
  const [expand, setExpand] = useState<1 | 2>(1)

  // Reset the form whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    const m = material
    setKind(m?.kind ?? defaultKind)
    setName(m?.name ?? '')
    setCategory((m?.category as MaterialCategory) ?? (defaultKind === 'paint' ? 'paint' : 'laminate'))
    setColorHex(m?.colorHex ?? '#d9cbb3')
    setBrand(m?.brand ?? '')
    setCode(m?.code ?? '')
    setNotes(m?.notes ?? '')
    setFinish(m?.settings?.defaultFinish ?? (defaultKind === 'paint' ? 'matte' : 'satin'))
    setDelight(m?.settings?.prep?.delight ?? 0.85)
    setSeamless(m?.settings?.prep?.seamless ?? 0.12)
    setLayout(m?.settings?.tile?.layout ?? 'grid')
    setGroutMm(m?.settings?.tile?.groutMm ?? 2)
    setGroutColor(m?.settings?.tile?.groutColor ?? '#cfcac2')
    setVariation(m?.settings?.tile?.variation ?? true)
    setPhoto(null)
    setPhotoFile(null)
    setCorners(null)
    setPreparedPreview(null)
    setPrepChanged(false)
    setWhiteBalance(m?.settings?.prep?.whiteBalance ?? null)
    setPickingWhite(false)
    // Existing materials keep the method they were prepared with.
    setSeamlessMode(m?.settings?.prep?.seamlessMode ?? (m ? 'blend' : 'cut'))
    setExpand(m?.settings?.prep?.expand ?? 1)
    // Physical size of the cornered sample region (before seamless trimming).
    setWidthMm(m?.settings?.prep?.regionWidthMm ?? m?.widthMm ?? 600)
    setHeightMm(m?.settings?.prep?.regionHeightMm ?? m?.heightMm ?? 600)
    if (m?.kind === 'texture' && m.sourceAssetId) {
      setBusy('Loading sample…')
      visualizerApi
        .getAssetBlob(m.sourceAssetId)
        .then(async (blob) => {
          const full = await decodeForDisplay(blob)
          const small = limitSize(full, PHOTO_MAX_SIDE)
          const s = small.width / full.width
          setPhoto(small)
          setPhotoScale(s)
          const c = m.settings?.prep?.corners
          setCorners(c ? (c.map(([x, y]) => ({ x: x * s, y: y * s })) as Quad) : fullQuad(small))
        })
        .catch(() => toast({ title: 'Could not load the original sample', variant: 'destructive' }))
        .finally(() => setBusy(null))
    }
  }, [open, material, defaultKind]) // eslint-disable-line react-hooks/exhaustive-deps

  const isTile = category === 'tile'

  // Live preview of the prepared texture (low resolution for speed).
  useEffect(() => {
    if (kind !== 'texture' || !photo || !corners || widthMm <= 0 || heightMm <= 0) return
    const t = setTimeout(() => {
      try {
        const r = prepareMaterial(photo, { corners, widthMm, heightMm, delight, seamless, maxSide: 384, whiteBalance, seamlessMode, expand: isTile ? 1 : expand })
        setPreparedPreview(r.texture)
      } catch {
        setPreparedPreview(null)
      }
    }, 150)
    return () => clearTimeout(t)
  }, [kind, photo, corners, widthMm, heightMm, delight, seamless, whiteBalance, seamlessMode, expand, isTile])

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return
    setBusy('Reading sample…')
    try {
      const full = await decodeForDisplay(file)
      const small = limitSize(full, PHOTO_MAX_SIDE)
      setPhoto(small)
      setPhotoFile(file)
      setPhotoScale(small.width / full.width)
      setCorners(fullQuad(small))
      setWhiteBalance(null)
      setPrepChanged(true)
      if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120))
    } catch (err) {
      toast({ title: 'Could not read image', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!name.trim()) return toast({ title: 'Give the material a name', variant: 'destructive' })
    const base: MaterialInput = {
      name: name.trim(),
      kind,
      category: kind === 'paint' ? 'paint' : category,
      brand: brand.trim() || null,
      code: code.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      let saved: VizMaterial
      if (kind === 'paint') {
        if (!/^#[0-9a-f]{6}$/i.test(colorHex)) return toast({ title: 'Enter a valid hex colour, e.g. #d9cbb3', variant: 'destructive' })
        setBusy('Saving…')
        const data = { ...base, colorHex, settings: { defaultFinish: finish } }
        saved = editing ? await visualizerApi.updateMaterial(material!.id, data) : await visualizerApi.createMaterial(data, {})
      } else {
        if (!photo || !corners) return toast({ title: 'Upload a photo of the sample', variant: 'destructive' })
        if (!(widthMm > 0 && heightMm > 0)) return toast({ title: 'Enter the real size of the sample area', variant: 'destructive' })
        setBusy('Preparing texture…')
        await new Promise((r) => setTimeout(r, 30)) // let the spinner paint
        const settings: VizMaterial['settings'] = {
          prep: {
            corners: corners.map((p) => [p.x / photoScale, p.y / photoScale]) as [[number, number], [number, number], [number, number], [number, number]],
            delight,
            seamless,
            regionWidthMm: widthMm,
            regionHeightMm: heightMm,
            whiteBalance,
            seamlessMode,
            expand: isTile ? 1 : expand,
          },
          defaultPattern: isTile ? 'tiles' : 'continuous',
          tile: { layout, groutMm, groutColor, variation },
          defaultFinish: finish,
        }
        const needsTexture = !editing || prepChanged
        let texture: Blob | undefined
        let physical = { widthMm, heightMm }
        if (needsTexture) {
          const prepared = prepareMaterial(photo, { corners, widthMm, heightMm, delight, seamless, maxSide: TEXTURE_MAX_SIDE, whiteBalance, seamlessMode, expand: isTile ? 1 : expand })
          texture = await encodePng(prepared.texture)
          physical = { widthMm: prepared.widthMm, heightMm: prepared.heightMm }
        } else {
          physical = { widthMm: material!.widthMm ?? widthMm, heightMm: material!.heightMm ?? heightMm }
        }
        setBusy('Saving…')
        const data = { ...base, widthMm: round2(physical.widthMm), heightMm: round2(physical.heightMm), settings }
        const files = { texture, source: photoFile ?? undefined }
        saved = editing ? await visualizerApi.updateMaterial(material!.id, data, files) : await visualizerApi.createMaterial(data, files)
      }
      await qc.invalidateQueries({ queryKey: ['visualizer', 'materials'] })
      toast({ title: editing ? 'Material updated' : 'Material added to library' })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Could not save material', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const setPrep = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setPrepChanged(true)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit material' : 'Add material'}</DialogTitle>
          <DialogDescription>
            {kind === 'paint'
              ? 'Pick the paint colour as published by the manufacturer. Screen colours are approximate.'
              : 'Upload a photo of a laminate, veneer or tile sample. Drag the corners onto the sample edges, then enter its real size so it renders at true scale.'}
          </DialogDescription>
        </DialogHeader>

        {!editing && (
          <Segmented
            value={kind}
            onChange={(k) => {
              setKind(k)
              setCategory(k === 'paint' ? 'paint' : 'laminate')
              setFinish(k === 'paint' ? 'matte' : 'satin')
            }}
            options={[
              { value: 'texture', label: 'Laminate / tile sample' },
              { value: 'paint', label: 'Paint colour' },
            ]}
          />
        )}

        <div className="grid gap-5 md:grid-cols-[1.35fr_1fr]">
          {/* Left: sample / colour */}
          <div className="space-y-3">
            {kind === 'paint' ? (
              <div className="space-y-3">
                <div className="h-56 w-full rounded-lg border shadow-inner" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex : '#ccc' }} />
                <div className="flex items-end gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium">Colour</span>
                    <input type="color" className="block h-9 w-14 cursor-pointer rounded border bg-background" value={colorHex} onChange={(e) => setColorHex(e.target.value)} aria-label="Paint colour picker" />
                  </label>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="mat-hex" className="text-xs">Hex</Label>
                    <Input id="mat-hex" value={colorHex} onChange={(e) => setColorHex(e.target.value.trim())} placeholder="#d9cbb3" />
                  </div>
                  {/^#[0-9a-f]{6}$/i.test(colorHex) && <span className="pb-2 text-xs text-muted-foreground">RGB {hexToRgb(colorHex).join(', ')}</span>}
                </div>
              </div>
            ) : photo && corners ? (
              <>
                <CornerEditor
                  photo={photo}
                  corners={corners}
                  onChange={setPrep(setCorners)}
                  onPick={
                    pickingWhite
                      ? (p) => {
                          setWhiteBalance(samplePatch(photo, p.x, p.y, Math.max(3, Math.round(Math.min(photo.width, photo.height) / 150))))
                          setPickingWhite(false)
                          setPrepChanged(true)
                        }
                      : undefined
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={pickingWhite ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPickingWhite((v) => !v)}
                    title="Click a white or grey card (or a known neutral area) in the photo to remove its colour cast"
                    data-testid="viz-wb-pick"
                  >
                    <Pipette className="mr-1.5 h-3.5 w-3.5" /> {pickingWhite ? 'Click a neutral spot…' : 'White balance'}
                  </Button>
                  {whiteBalance && (
                    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                      <span className="h-3 w-3 rounded-sm border" style={{ backgroundColor: rgbToHex(...whiteBalance) }} /> neutral set
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setWhiteBalance(null); setPrepChanged(true) }} aria-label="Remove white balance">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => { setCorners(fullQuad(photo)); setPrepChanged(true) }}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset corners
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                    <Upload className="h-3.5 w-3.5" /> Replace photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0])} />
                  </label>
                </div>
              </>
            ) : (
              <label className="flex h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                <span>{busy ?? 'Upload a sample photo (JPG, PNG, WebP)'}</span>
                <span className="text-xs">Shoot it flat, in even daylight, filling the frame.</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0])} />
              </label>
            )}

            {kind === 'texture' && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Prepared texture (repeated 3 × 3)</span>
                  <span className="text-[11px] text-muted-foreground">check for visible seams</span>
                </div>
                <TiledPreview image={preparedPreview} tiles={3} />
                <RangeField label="Remove photographed lighting" value={delight} min={0} max={1} step={0.05} onChange={setPrep(setDelight)} format={(v) => `${Math.round(v * 100)}%`} hint="Evens out hot-spots and vignetting from the photo" />
                <RangeField label="Seamless repeat" value={seamless} min={0} max={0.4} step={0.01} onChange={setPrep(setSeamless)} format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)} hint="Joins opposite edges so the repeat is invisible. Use Off for single tiles with their own borders." />
                {seamless > 0 && (
                  <Segmented
                    size="xs"
                    value={seamlessMode}
                    onChange={setPrep(setSeamlessMode)}
                    options={[
                      { value: 'cut', label: 'Seam cut (grain, stone)', title: 'Joins the edges along the best-matching line — no ghosted double grain' },
                      { value: 'blend', label: 'Cross-fade', title: 'Fades one edge into the other — fine for soft, uniform textures' },
                    ]}
                  />
                )}
                {!isTile && seamless > 0 && (
                  <label className="flex items-start gap-2 text-xs" title="Builds a texture twice as large per side from pieces of the sample, so big surfaces repeat 4× less">
                    <input type="checkbox" checked={expand === 2} onChange={(e) => setPrep(setExpand)(e.target.checked ? 2 : 1)} className="mt-0.5" data-testid="viz-expand" />
                    <span>
                      Expand sample ×2 <span className="text-muted-foreground">— less visible repetition on large wardrobes and walls (slower to prepare)</span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Right: details */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="mat-name" className="text-xs">Name</Label>
              <Input id="mat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'paint' ? 'e.g. Warm Linen' : 'e.g. Natural Walnut'} maxLength={255} />
            </div>
            {kind === 'texture' && (
              <div className="space-y-1">
                <span className="text-xs font-medium">Category</span>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as MaterialCategory)} aria-label="Category">
                  {MATERIAL_CATEGORIES.filter((c) => c !== 'paint').map((c) => (
                    <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mat-brand" className="text-xs">Brand</Label>
                <Input id="mat-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Manufacturer" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mat-code" className="text-xs">Code / shade</Label>
                <Input id="mat-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Catalogue no." />
              </div>
            </div>
            {kind === 'texture' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label={isTile ? 'Tile width' : 'Sample width'} value={widthMm} onChange={setPrep(setWidthMm)} min={1} suffix="mm" />
                  <NumberField label={isTile ? 'Tile height' : 'Sample height'} value={heightMm} onChange={setPrep(setHeightMm)} min={1} suffix="mm" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isTile
                    ? 'Real size of ONE tile, edge to edge, without grout. Set seamless blend to Off for tiles.'
                    : 'Real size of the area inside the corners. Measure the physical sample.'}
                </p>
                {isTile && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <span className="text-xs font-medium">Default tiling</span>
                    <Segmented size="xs" value={layout} onChange={setLayout} options={TILE_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABELS[l] }))} />
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <NumberField label="Grout" value={groutMm} onChange={setGroutMm} min={0} max={50} step={0.5} suffix="mm" />
                      <input type="color" className="h-8 w-12 cursor-pointer rounded border" value={groutColor} onChange={(e) => setGroutColor(e.target.value)} aria-label="Grout colour" />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={variation} onChange={(e) => setVariation(e.target.checked)} /> Rotate tiles randomly (less repetition)
                    </label>
                  </div>
                )}
              </>
            )}
            <div className="space-y-1">
              <span className="text-xs font-medium">Default finish</span>
              <Segmented value={finish} onChange={setFinish} options={FINISHES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mat-notes" className="text-xs">Notes</Label>
              <Textarea id="mat-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Supplier, thickness, price…" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancel</Button>
          <Button onClick={save} disabled={!!busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ?? (editing ? 'Save changes' : 'Add to library')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function round2(v: number) {
  return Math.round(v * 100) / 100
}

/** Photo with four draggable corner handles (TL, TR, BR, BL). */
function CornerEditor({ photo, corners, onChange, onPick }: { photo: RGBAImage; corners: Quad; onChange: (q: Quad) => void; onPick?: (p: { x: number; y: number }) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = photo.width
    c.height = photo.height
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(photo.data), photo.width, photo.height), 0, 0)
  }, [photo])

  const toImage = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(photo.width, ((e.clientX - r.left) / r.width) * photo.width)),
      y: Math.max(0, Math.min(photo.height, ((e.clientY - r.top) / r.height) * photo.height)),
    }
  }
  const handle = Math.max(photo.width, photo.height) / 60
  const labels = ['TL', 'TR', 'BR', 'BL']
  const MAX_H = 360

  // Width is capped so the box keeps the photo's aspect ratio (canvas and SVG must
  // map identically); padding keeps edge handles fully grabbable.
  return (
    <div className="p-3">
      <div
        className="relative mx-auto w-full select-none"
        style={{ aspectRatio: `${photo.width} / ${photo.height}`, maxWidth: (MAX_H * photo.width) / photo.height }}
      >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded-md border" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        className={`absolute inset-0 h-full w-full touch-none overflow-visible ${onPick ? 'cursor-cell' : ''}`}
        onPointerDown={(e) => {
          if (onPick) onPick(toImage(e))
        }}
        onPointerMove={(e) => {
          if (drag === null) return
          const p = toImage(e)
          const next = corners.map((c, i) => (i === drag ? p : c)) as Quad
          onChange(next)
        }}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <path
          d={`M0 0H${photo.width}V${photo.height}H0Z M${corners.map((c) => `${c.x} ${c.y}`).join(' L')} Z`}
          fill="rgba(0,0,0,0.45)"
          fillRule="evenodd"
        />
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={handle / 5} />
        {corners.map((c, i) => (
          <g key={i}>
            <circle
              cx={c.x}
              cy={c.y}
              r={handle}
              fill="#22d3ee"
              fillOpacity={0.35}
              stroke="#fff"
              strokeWidth={handle / 5}
              className={onPick ? 'pointer-events-none' : 'cursor-move'}
              aria-label={`Corner ${labels[i]}`}
              onPointerDown={(e) => {
                if (onPick) return
                e.stopPropagation()
                ;(e.target as Element).setPointerCapture?.(e.pointerId)
                setDrag(i)
              }}
            />
            <text x={c.x} y={c.y - handle * 1.4} textAnchor="middle" fontSize={handle} fill="#fff" stroke="#000" strokeWidth={handle / 10} paintOrder="stroke">
              {labels[i]}
            </text>
          </g>
        ))}
      </svg>
      </div>
    </div>
  )
}

export function TiledPreview({ image, tiles }: { image: RGBAImage | null; tiles: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pattern = useMemo(() => image, [image])
  useEffect(() => {
    const c = ref.current
    if (!c || !pattern) return
    const tile = new OffscreenCanvas(pattern.width, pattern.height)
    tile.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pattern.data), pattern.width, pattern.height), 0, 0)
    const aspect = pattern.width / pattern.height
    const W = 480
    const H = Math.round(W / aspect)
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    const tw = W / tiles
    const th = H / tiles
    for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) ctx.drawImage(tile, x * tw, y * th, tw, th)
  }, [pattern, tiles])
  if (!image) return <div className="flex h-32 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">Preview appears after upload</div>
  return <canvas ref={ref} className="w-full rounded border" />
}
