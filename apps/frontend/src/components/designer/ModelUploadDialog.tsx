import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/visualizer/common'
import { useToast } from '@/components/ui/toast'
import { designerApi } from '@/api/designer'
import { apiErrorMessage } from '@/api/visualizer'
import { configureRenderer } from '@/lib/designer/render'

interface Inspected {
  file: File
  thumbnail: Blob | null
  thumbUrl: string | null
  size: { w: number; d: number; h: number }
}

/** Loads a GLB in the browser to measure it (metres, Y-up) and render a catalog thumbnail. */
async function inspectGlb(file: File): Promise<Inspected> {
  const buf = await file.arrayBuffer()
  const gltf = await new GLTFLoader().parseAsync(buf, '')
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())

  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  let thumbnail: Blob | null = null
  try {
    renderer.setSize(256, 256, false)
    configureRenderer(renderer, 1.1)
    const scene = new THREE.Scene()
    scene.add(gltf.scene)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(2, 4, 3)
    scene.add(sun)
    const r = Math.max(size.x, size.y, size.z) || 1
    const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100)
    cam.position.copy(centre).add(new THREE.Vector3(r * 1.2, r * 0.9, r * 1.6))
    cam.lookAt(centre)
    renderer.render(scene, cam)
    thumbnail = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return {
    file,
    thumbnail,
    thumbUrl: thumbnail ? URL.createObjectURL(thumbnail) : null,
    size: { w: Math.round(size.x * 1000), d: Math.round(size.z * 1000), h: Math.round(size.y * 1000) },
  }
}

export function ModelUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [info, setInfo] = useState<Inspected | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('furniture')
  const [brand, setBrand] = useState('')
  const [price, setPrice] = useState('')
  const [dims, setDims] = useState({ w: 0, d: 0, h: 0 })
  const qc = useQueryClient()
  const { toast } = useToast()

  useEffect(() => {
    if (!open) {
      setInfo(null)
      setName('')
      setBrand('')
      setPrice('')
    }
  }, [open])
  useEffect(() => () => void (info?.thumbUrl && URL.revokeObjectURL(info.thumbUrl)), [info])

  const pick = async (file: File) => {
    setLoading(true)
    try {
      const i = await inspectGlb(file)
      setInfo(i)
      setDims(i.size)
      setName(file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim())
    } catch {
      toast({ title: 'Could not read that file', description: 'Upload a binary glTF (.glb). Export from SketchUp, Blender or 3ds Max as GLB.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // Models exported in centimetres or inches show up absurdly large or small.
  const suspicious = info && (Math.max(dims.w, dims.d, dims.h) > 8000 || Math.max(dims.w, dims.d, dims.h) < 50)

  const save = async () => {
    if (!info) return
    setSaving(true)
    try {
      await designerApi.uploadModel(info.file, info.thumbnail, {
        name: name.trim() || 'Model',
        category: category.trim() || 'furniture',
        widthMm: dims.w,
        depthMm: dims.d,
        heightMm: dims.h,
        price: price ? Number(price) : null,
        brand: brand.trim() || null,
      })
      await qc.invalidateQueries({ queryKey: ['designer', 'models'] })
      toast({ title: 'Model added to your catalog' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Upload failed', description: apiErrorMessage(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a 3D model</DialogTitle>
          <DialogDescription>GLB files only. Real-world size is read from the model (glTF uses metres) and can be corrected below.</DialogDescription>
        </DialogHeader>
        {!info ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-sm text-muted-foreground hover:border-primary">
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
            {loading ? 'Reading model…' : 'Choose a .glb file'}
            <input type="file" accept=".glb,model/gltf-binary" className="hidden" disabled={loading} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            {info.thumbUrl ? <img src={info.thumbUrl} alt="" className="aspect-square w-full rounded border bg-white object-contain" /> : <div className="aspect-square rounded border bg-muted" />}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="mdl-name">Name</Label>
                <Input id="mdl-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="mdl-cat">Category</Label>
                  <Input id="mdl-cat" value={category} maxLength={50} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mdl-brand">Brand / vendor</Label>
                  <Input id="mdl-brand" value={brand} maxLength={200} onChange={(e) => setBrand(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mdl-price">Price per piece (₹, optional)</Label>
                <Input id="mdl-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:col-span-2">
              <NumberField label="Width" value={dims.w} min={1} suffix="mm" onChange={(w) => setDims({ ...dims, w })} />
              <NumberField label="Depth" value={dims.d} min={1} suffix="mm" onChange={(d) => setDims({ ...dims, d })} />
              <NumberField label="Height" value={dims.h} min={1} suffix="mm" onChange={(h) => setDims({ ...dims, h })} />
            </div>
            {suspicious && (
              <p className="text-xs text-amber-600 sm:col-span-2">
                These dimensions look off. The model may have been exported in centimetres or inches. Correct the size before saving.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!info || saving || !(dims.w > 0 && dims.d > 0 && dims.h > 0)} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add to catalog
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
