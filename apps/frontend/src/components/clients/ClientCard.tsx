import { Link } from 'react-router-dom'
import { Mail, Phone, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ClientStatusBadge } from './ClientStatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { Client } from '@/types'

interface ClientCardProps {
  client: Client
}

export function ClientCard({ client }: ClientCardProps) {
  const totalPaid = client.totalPaid ?? 0
  const remaining = client.remainingBalance ?? client.totalDealAmount - totalPaid
  const progress = client.totalDealAmount > 0 ? (totalPaid / client.totalDealAmount) * 100 : 0

  return (
    <Link to={`/clients/${client.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate">{client.name}</h3>
              {client.email && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{client.email}</span>
                </div>
              )}
              {client.phone && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span>{client.phone}</span>
                </div>
              )}
            </div>
            <ClientStatusBadge status={client.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Payment progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Deal</p>
              <p className="text-sm font-semibold">{formatCurrency(client.totalDealAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(totalPaid)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due</p>
              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{formatCurrency(remaining)}</p>
            </div>
          </div>

          {/* Counts */}
          {client._count && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground border-t pt-2">
              <TrendingUp className="h-3 w-3" />
              <span>{client._count.payments} payments · {client._count.files} files</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
