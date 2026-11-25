import { useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RequirementsTab } from '@/components/procurement/RequirementsTab'
import { OrdersTab } from '@/components/procurement/OrdersTab'
import { VendorsTab } from '@/components/procurement/VendorsTab'
import { CatalogTab } from '@/components/procurement/CatalogTab'
import { useProcurementSummary } from '@/hooks/useProcurement'
import { useStudioProjects } from '@/hooks/useStudio'
import { cn, formatCurrency } from '@/lib/utils'

const TABS = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'orders', label: 'Purchase Orders' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'catalog', label: 'Price Lists' },
] as const
type TabKey = (typeof TABS)[number]['key']

export function ProcurementPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'requirements') as TabKey
  const projectId = params.get('projectId') ?? ''
  const catalogVendorId = params.get('vendorId') ?? ''

  const { data: projects = [] } = useStudioProjects()
  const { data: summary } = useProcurementSummary(projectId || undefined)

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  // Vendors and price lists are shared across projects, so the project filter
  // only applies to requirements and orders.
  const projectScoped = tab === 'requirements' || tab === 'orders'

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Procurement</h2>
          <p className="text-sm text-muted-foreground">Compare vendor quotes, raise purchase orders and track deliveries and margins</p>
        </div>
        {projectScoped && (
          <Select value={projectId || 'all'} onValueChange={(v) => update({ projectId: v === 'all' ? '' : v })}>
            <SelectTrigger className="sm:w-64"><SelectValue placeholder="All projects" /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {projectScoped && summary && summary.items.total + summary.orders.count > 0 && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Approved cost (before GST)</p>
            <p className="text-xl font-semibold mt-1">{formatCurrency(summary.approvedCost)}</p>
            {summary.budget !== null && (
              <p className={cn('text-xs mt-0.5', summary.approvedCost > summary.budget ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                of {formatCurrency(summary.budget)} budget
              </p>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Your margin</p>
            <p className={cn('text-xl font-semibold mt-1', summary.margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
              {formatCurrency(summary.margin)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {summary.marginPercent !== null ? `${summary.marginPercent.toFixed(1)}% of client value` : 'Add client rates to see margin'}
              {summary.itemsWithoutClientRate > 0 && summary.marginPercent !== null && ` · ${summary.itemsWithoutClientRate} without rate`}
            </p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Saved by comparing</p>
            <p className="text-xl font-semibold mt-1">{formatCurrency(summary.savings)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">vs the highest quote on each item</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Payable to vendors</p>
            <p className="text-xl font-semibold mt-1 text-amber-600 dark:text-amber-400">{formatCurrency(summary.orders.outstanding)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {summary.orders.awaitingDelivery} order{summary.orders.awaitingDelivery === 1 ? '' : 's'} awaiting delivery
            </p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => update({ tab: t.key === 'requirements' ? '' : t.key })}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'requirements' && <RequirementsTab projectId={projectId || undefined} />}
      {tab === 'orders' && <OrdersTab projectId={projectId || undefined} />}
      {tab === 'vendors' && <VendorsTab onShowCatalog={(id) => update({ tab: 'catalog', vendorId: id })} />}
      {tab === 'catalog' && <CatalogTab vendorId={catalogVendorId} onVendorChange={(id) => update({ vendorId: id })} />}
    </div>
  )
}
