import { useState } from 'react'
import { UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClientTable } from '@/components/clients/ClientTable'
import { ClientForm } from '@/components/clients/ClientForm'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/EmptyState'
import { useClients } from '@/hooks/useClients'
import { cn } from '@/lib/utils'

type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'ON_HOLD'

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
]

export function ClientsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const limit = 10

  const { data, isLoading } = useClients({
    search: search || undefined,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    page,
    limit,
    sort: sortBy,
    order: sortOrder,
  })

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  const handleStatusFilter = (status: StatusFilter) => {
    setStatusFilter(status)
    setPage(1)
  }

  const clients = data?.data ?? []
  const totalPages = data?.totalPages ?? 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            placeholder="Search clients..."
            className="w-64"
          />
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="gap-2 shrink-0">
          <UserPlus className="h-4 w-4" />
          Add Client
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleStatusFilter(tab.value)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              statusFilter === tab.value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {!isLoading && clients.length === 0 && !search ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client to get started with Klyent."
          action={{ label: 'Add Client', onClick: () => setIsFormOpen(true) }}
        />
      ) : (
        <>
          <ClientTable
            clients={clients}
            isLoading={isLoading}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, data?.total ?? 0)} of {data?.total ?? 0}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ClientForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
      />
    </div>
  )
}
