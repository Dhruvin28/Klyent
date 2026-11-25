import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MaterialSwatch } from '@/components/visualizer/common'
import { SQFT_PER_SQM, formatQuantity } from '@/lib/visualizer/estimate'
import { bomToProposal, computeBom } from '@/lib/designer/bom'
import type { Plan } from '@/lib/designer/types'
import { useDesignerLibraries } from './FinishField'

const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const sqft = (sqm: number) => `${(sqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 0 })} sq ft`

export function BomDialog({ open, onOpenChange, plan, projectName, clientId }: { open: boolean; onOpenChange: (o: boolean) => void; plan: Plan; projectName: string; clientId: string | null }) {
  const { materialMap, models } = useDesignerLibraries()
  const navigate = useNavigate()
  const bom = useMemo(() => (open ? computeBom(plan, materialMap, models) : null), [open, plan, materialMap, models])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bill of materials</DialogTitle>
          <DialogDescription>
            Quantities from the 3D design: net wall areas (doors and windows deducted), carpet areas and shutter areas. Ordering units and rates come from each material’s settings in the Visualizer library.
          </DialogDescription>
        </DialogHeader>
        {bom && (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            {bom.rooms.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rooms</h4>
                <div className="flex flex-wrap gap-2 text-sm">
                  {bom.rooms.map((r, i) => (
                    <span key={i} className="rounded-md border px-2 py-1">
                      {r.name}: <b>{sqft(r.areaSqm)}</b>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Library materials</h4>
              {bom.materials.lines.length ? (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Material</th>
                      <th className="py-1 font-medium">Area</th>
                      <th className="py-1 font-medium">Order</th>
                      <th className="py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bom.materials.lines.map((l) => (
                      <tr key={l.materialId} className="align-top">
                        <td className="py-1.5">
                          <div className="flex items-start gap-2">
                            <MaterialSwatch material={l.material} className="h-8 w-8 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium">{l.material.name}</p>
                              <p className="text-[11px] text-muted-foreground">{l.surfaces.join(', ')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-1.5 tabular-nums">{sqft(l.areaSqm)}</td>
                        <td className="py-1.5" title={l.basis}>{formatQuantity(l)}</td>
                        <td className="py-1.5 text-right tabular-nums">{l.cost != null ? money(l.cost) : <span className="text-muted-foreground">no rate</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">No library materials applied yet. Pick laminates, tiles or paints from the library on walls, floors or shutters to get quantities.</p>
              )}
            </section>

            {bom.colors.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plain colours (not priced)</h4>
                <ul className="space-y-1 text-sm">
                  {bom.colors.map((c) => (
                    <li key={c.hex} className="flex items-center gap-2">
                      <span className="h-4 w-4 shrink-0 rounded border" style={{ backgroundColor: c.hex }} />
                      <span className="font-mono text-xs">{c.hex.toUpperCase()}</span>
                      <span className="tabular-nums">{sqft(c.areaSqm)}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.surfaces.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Furniture</h4>
              {bom.furniture.length ? (
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {bom.furniture.map((f, i) => (
                      <tr key={i}>
                        <td className="py-1.5">
                          <p className="font-medium">{f.name} × {f.count}</p>
                          <p className="text-[11px] text-muted-foreground">{f.detail}</p>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{f.amount != null ? money(f.amount) : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">No furniture placed.</p>
              )}
            </section>

            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">
                Priced total{bom.materials.unpriced ? ` (${bom.materials.unpriced} material${bom.materials.unpriced > 1 ? 's' : ''} without a rate)` : ''}
              </span>
              <span className="text-lg font-semibold tabular-nums">{money(bom.total)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            className="gap-2"
            disabled={!bom || (!bom.materials.lines.length && !bom.furniture.length && !bom.colors.length)}
            onClick={() => bom && navigate('/proposals/new/cost-breakup', { state: { fromVisualizer: bomToProposal(projectName, clientId, bom) } })}
          >
            <FileText className="h-4 w-4" /> Create proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
