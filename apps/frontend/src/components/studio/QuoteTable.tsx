import { Link } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { useStudioQuotes } from '@/hooks/useStudio'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  quoted: 'secondary',
  revised: 'secondary',
  approved: 'default',
  rejected: 'destructive',
}

export function QuoteTable({ projectId }: { projectId: string }) {
  const { data: quotes, isLoading } = useStudioQuotes(projectId)

  if (isLoading) return <LoadingSpinner className="py-12" />
  if (!quotes || quotes.length === 0) {
    return <EmptyState icon={Receipt} title="No price quotes yet" description="Vendor prices mentioned in conversations or documents are extracted here automatically." />
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Compare these against other vendors and turn the best into a purchase order.</span>
        <Link to={`/procurement?projectId=${projectId}`} className="font-medium text-primary hover:underline whitespace-nowrap">
          Open Procurement →
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material / Description</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map((q) => (
            <TableRow key={q.id}>
              <TableCell>{q.materialName || q.description || '—'}</TableCell>
              <TableCell>{q.vendorName || '—'}</TableCell>
              <TableCell>{q.price ? `₹${q.price}${q.unit ? `/${q.unit}` : ''}` : '—'}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[q.status] ?? 'secondary'}>{q.status}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{new Date(q.createdAt).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
