import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, CreditCard } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/common/EmptyState'
import { PaymentForm } from '@/components/payments/PaymentForm'
import { usePayments } from '@/hooks/usePayments'
import { useClients } from '@/hooks/useClients'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PaymentMethod } from '@/types'

const methodColors: Record<PaymentMethod, string> = {
  CASH: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  ONLINE: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  CHEQUE: 'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
}

export function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [clientId, setClientId] = useState<string>(searchParams.get('clientId') ?? '')
  const [method, setMethod] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const limit = 20

  // Auto-open add dialog when navigated from client table quick-pay icon
  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      setAddOpen(true)
      // Clean the param from URL without re-render loop
      const next = new URLSearchParams(searchParams)
      next.delete('add')
      setSearchParams(next, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: paymentsData, isLoading } = usePayments({
    clientId: clientId || undefined,
    method: method || undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate).toISOString() : undefined,
    page,
    limit,
    sort: 'date',
    order: 'desc',
  })
  const { data: clientsData } = useClients({ limit: 100 })

  const payments = paymentsData?.data ?? []
  const totalPages = paymentsData?.totalPages ?? 1
  const totalAmount = paymentsData?.totalAmount ?? 0

  const resetFilters = () => {
    setClientId('')
    setMethod('')
    setStartDate('')
    setEndDate('')
    setPage(1)
    setSearchParams({}, { replace: true })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">All Payments</h2>
          <p className="text-sm text-muted-foreground">Track payments across all clients</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          Add Payment
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 w-full sm:w-auto">
          <p className="text-xs text-muted-foreground font-medium">Client</p>
          <Select value={clientId || 'all'} onValueChange={(v) => { setClientId(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {(clientsData?.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 w-full sm:w-auto">
          <p className="text-xs text-muted-foreground font-medium">Method</p>
          <Select value={method || 'all'} onValueChange={(v) => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="All methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              <SelectItem value="CASH">Cash</SelectItem>
              <SelectItem value="ONLINE">Online</SelectItem>
              <SelectItem value="CHEQUE">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 w-full sm:w-auto">
          <p className="text-xs text-muted-foreground font-medium">From</p>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
            className="w-full sm:w-40"
          />
        </div>

        <div className="space-y-1 w-full sm:w-auto">
          <p className="text-xs text-muted-foreground font-medium">To</p>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
            className="w-full sm:w-40"
          />
        </div>

        {(clientId || method || startDate || endDate) && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="self-end">
            Clear filters
          </Button>
        )}
      </div>

      {/* Summary card */}
      {!isLoading && payments.length > 0 && (
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm opacity-80">Total (current view)</p>
              <p className="text-2xl font-bold">{formatCurrency(totalAmount)}</p>
            </div>
            <CreditCard className="h-10 w-10 opacity-40" />
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {isLoading ? (
        <Table>
          <TableHeader>
            <TableRow>
              {['Client', 'Amount', 'Method', 'Date', 'Notes', 'Recorded by'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payments found"
          description="No payments match your current filters."
          action={{ label: 'Add Payment', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Recorded by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="font-medium">
                    {payment.client?.name ?? '—'}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatCurrency(payment.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge className={methodColors[payment.method]}>
                      {payment.method.charAt(0) + payment.method.slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(payment.date)}</TableCell>
                  <TableCell className="text-muted-foreground max-w-48 truncate">
                    {payment.notes ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{payment.user?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages} ({paymentsData?.total} total)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Payment dialog */}
      <PaymentForm
        clientId={clientId || undefined}
        clients={clientsData?.data ?? []}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  )
}
