import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, Eye, Pencil, Trash2, PlusCircle, Bell } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ClientStatusBadge } from './ClientStatusBadge'
import { ClientForm } from './ClientForm'
import { PaymentReminderDialog } from './PaymentReminderDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { formatCurrency } from '@/lib/utils'
import { useDeleteClient } from '@/hooks/useClients'
import { useToast } from '@/components/ui/toast'
import type { Client } from '@/types'

interface ClientTableProps {
  clients: Client[]
  isLoading: boolean
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  onSort?: (column: string) => void
}

export function ClientTable({ clients, isLoading, sortBy, sortOrder, onSort }: ClientTableProps) {
  const navigate = useNavigate()
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reminderClient, setReminderClient] = useState<Client | null>(null)
  const deleteClient = useDeleteClient()
  const { toast } = useToast()

  const SortButton = ({ column, label }: { column: string; label: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 gap-1 font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort?.(column)}
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === column ? 'text-foreground' : ''}`} />
    </Button>
  )

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteClient.mutateAsync(deletingId)
      toast({ title: 'Client deleted', description: 'The client has been removed.' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete client.', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {['Name', 'Email', 'Phone', 'Status', 'Deal Amount', 'Total Paid', 'Remaining', 'Actions'].map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 8 }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (!clients.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No clients found</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><SortButton column="name" label="Name" /></TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead><SortButton column="totalDealAmount" label="Deal Amount" /></TableHead>
            <TableHead>Total Paid</TableHead>
            <TableHead>Remaining</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const totalPaid = client.totalPaid ?? 0
            const remaining = client.remainingBalance ?? client.totalDealAmount - totalPaid
            return (
              <TableRow key={client.id}>
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="text-muted-foreground">{client.email ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{client.phone ?? '—'}</TableCell>
                <TableCell><ClientStatusBadge status={client.status} /></TableCell>
                <TableCell>{formatCurrency(client.totalDealAmount)}</TableCell>
                <TableCell className="text-green-600 dark:text-green-400">{formatCurrency(totalPaid)}</TableCell>
                <TableCell className="text-orange-600 dark:text-orange-400">{formatCurrency(remaining)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                      title="Record payment"
                      onClick={() => navigate(`/payments?clientId=${client.id}&add=true`)}
                    >
                      <PlusCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                      title="Send payment reminder"
                      onClick={() => setReminderClient(client)}
                    >
                      <Bell className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingClient(client)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeletingId(client.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      </div>

      {editingClient && (
        <ClientForm
          client={editingClient}
          open={!!editingClient}
          onOpenChange={(open) => { if (!open) setEditingClient(null) }}
        />
      )}

      <PaymentReminderDialog
        client={reminderClient}
        open={!!reminderClient}
        onOpenChange={(open) => { if (!open) setReminderClient(null) }}
      />

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null) }}
        title="Delete Client"
        description="Are you sure you want to delete this client? This action cannot be undone and will remove all associated data."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        isLoading={deleteClient.isPending}
      />
    </>
  )
}
