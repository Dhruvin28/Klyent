import { Pipette, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { linearToSrgbExact, rgbToHex } from '@/lib/visualizer/color'
import type { SceneCalibration } from '@/lib/visualizer/types'
import type { VizEditor } from './useVizEditor'

const REFERENCES: { albedo: number; label: string }[] = [
  { albedo: 0.85, label: 'White paint / ceiling' },
  { albedo: 0.75, label: 'Off-white' },
  { albedo: 0.55, label: 'Light grey' },
]

/** Scene-wide exposure & white balance, measured from a neutral surface in the render. */
export function ScenePanel({ editor, onPick, picking }: { editor: VizEditor; onPick: () => void; picking: boolean }) {
  const c = editor.state.calibration ?? null
  const set = (patch: Partial<SceneCalibration> | null) =>
    editor.setState((s) => ({ ...s, calibration: patch === null ? null : ({ ...(s.calibration as SceneCalibration), ...patch } as SceneCalibration) }))
  const swatch = c ? rgbToHex(...(c.white.map((v) => linearToSrgbExact(v)) as [number, number, number])) : null

  return (
    <div className="space-y-2" data-testid="viz-scene-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scene light</h3>
        <Button size="sm" variant={picking ? 'default' : 'outline'} className="h-7 gap-1 px-2 text-xs" onClick={onPick} data-testid="viz-calibrate">
          <Pipette className="h-3.5 w-3.5" /> {c ? 'Re-pick' : 'Calibrate'}
        </Button>
      </div>
      {!c ? (
        <p className="text-[11px] text-muted-foreground">
          Click <span className="font-medium text-foreground">Calibrate</span>, then a white wall or ceiling in the render. New materials then take on the render’s exposure
          and light colour instead of showing at swatch brightness.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border p-2">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded border" style={{ backgroundColor: swatch! }} title={`Measured ${swatch}`} />
            <label className="flex flex-1 items-center gap-2 text-xs">
              <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="viz-calibration-enabled" />
              Use for all surfaces
            </label>
            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => set(null)} aria-label="Remove calibration">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">The picked surface is</span>
            <select
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={c.albedo}
              onChange={(e) => set({ albedo: Number(e.target.value) })}
              aria-label="Reference surface"
            >
              {REFERENCES.map((r) => (
                <option key={r.albedo} value={r.albedo}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
