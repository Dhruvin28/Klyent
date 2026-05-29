import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useClients } from '@/hooks/useClients'
import { formatCurrency } from '@/lib/utils'
import type { DashboardStats } from '@/types'

export type DashboardTile = 'revenue' | 'clients' | 'pending' | 'active'

interface Props {
  tile: DashboardTile | null
  stats: DashboardStats | undefined
  onClose: () => void
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function RevenueDetail({ stats }: { stats: DashboardStats }) {
  const rows = [...stats.monthlyRevenue].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month
  )
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No revenue data yet.</p>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{formatCurrency(stats.totalRevenue)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Monthly avg (last 12m)</p>
          <p className="text-2xl font-bold">
            {formatCurrency(rows.reduce((s, r) => s + r.total, 0) / Math.max(rows.length, 1))}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.year}-${r.month}`}>
                <TableCell>{MONTH_NAMES[r.month - 1]} {r.year}</TableCell>
                <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(r.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ClientsDetail({ stats }: { stats: DashboardStats }) {
  const breakdown = [
    { label: 'Active', count: stats.activeClients, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
    { label: 'Completed', count: stats.completedClients, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
    { label: 'On Hold', count: stats.onHoldClients, color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {breakdown.map(({ label, count, color }) => (
          <div key={label} className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-bold">{count}</p>
            <Badge className={`mt-1 border-transparent text-xs ${color}`}>{label}</Badge>
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-4 flex items-center justify-between">
        <span className="font-medium">Total Clients</span>
        <span className="text-2xl font-bold">{stats.totalClients}</span>
      </div>
    </div>
  )
}

function PendingDetail() {
  const { data, isLoading } = useClients({ limit: 100 })
  const clients = (data?.data ?? [])
    .map((c) => ({ ...c, pending: Math.max(0, c.totalDealAmount - (c.totalPaid ?? 0)) }))
    .filter((c) => c.pending > 0)
    .sort((a, b) => b.pending - a.pending)

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
  if (!clients.length) return <p className="py-8 text-center text-sm text-muted-foreground">No pending payments — all clients are settled!</p>

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-4">
        <p className="text-xs text-muted-foreground">Total Pending</p>
        <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
          {formatCurrency(clients.reduce((s, c) => s + c.pending, 0))}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Deal</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Pending</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{c.status.replace('_', ' ')}</Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(c.totalDealAmount)}</TableCell>
                <TableCell className="text-right text-green-600 dark:text-green-400">{formatCurrency(c.totalPaid ?? 0)}</TableCell>
                <TableCell className="text-right font-semibold text-orange-600 dark:text-orange-400">{formatCurrency(c.pending)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ActiveDetail() {
  const { data, isLoading } = useClients({ status: 'ACTIVE', limit: 100 })
  const clients = data?.data ?? []

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
  if (!clients.length) return <p className="py-8 text-center text-sm text-muted-foreground">No active clients.</p>

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Deal</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => {
            const remaining = Math.max(0, c.totalDealAmount - (c.totalPaid ?? 0))
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(c.totalDealAmount)}</TableCell>
                <TableCell className="text-right text-green-600 dark:text-green-400">{formatCurrency(c.totalPaid ?? 0)}</TableCell>
                <TableCell className="text-right text-orange-600 dark:text-orange-400">{formatCurrency(remaining)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const TITLES: Record<DashboardTile, string> = {
  revenue: 'Revenue Breakdown',
  clients: 'Client Overview',
  pending: 'Pending Payments',
  active: 'Active Clients',
}

export function DashboardDetailModal({ tile, stats, onClose }: Props) {
  return (
    <Dialog open={!!tile} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[620px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tile ? TITLES[tile] : ''}</DialogTitle>
        </DialogHeader>
        {tile === 'revenue' && stats && <RevenueDetail stats={stats} />}
        {tile === 'clients' && stats && <ClientsDetail stats={stats} />}
        {tile === 'pending' && <PendingDetail />}
        {tile === 'active' && <ActiveDetail />}
      </DialogContent>
    </Dialog>
  )
}
