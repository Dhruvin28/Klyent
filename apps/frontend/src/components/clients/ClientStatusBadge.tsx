import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ClientStatus } from '@/types'

interface ClientStatusBadgeProps {
  status: ClientStatus
  className?: string
}

const statusConfig: Record<ClientStatus, { label: string; className: string }> = {
  ACTIVE: {
    label: 'Active',
    className: 'border-transparent bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  },
  ON_HOLD: {
    label: 'On Hold',
    className: 'border-transparent bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
}

export function ClientStatusBadge({ status, className }: ClientStatusBadgeProps) {
  const config = statusConfig[status]
  return (
    <Badge className={cn(config.className, className)}>
      {config.label}
    </Badge>
  )
}
