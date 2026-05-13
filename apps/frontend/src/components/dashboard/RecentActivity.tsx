import {
  CreditCard,
  Upload,
  UserPlus,
  Edit,
  MessageSquare,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatDateTime } from '@/lib/utils'
import type { ActivityLog, ActivityType } from '@/types'

interface RecentActivityProps {
  activities: ActivityLog[]
}

const activityConfig: Record<ActivityType, { icon: typeof CreditCard; label: string; color: string }> = {
  PAYMENT_ADDED: { icon: CreditCard, label: 'Payment recorded', color: 'text-green-500' },
  PAYMENT_UPDATED: { icon: Edit, label: 'Payment updated', color: 'text-blue-500' },
  PAYMENT_DELETED: { icon: Trash2, label: 'Payment deleted', color: 'text-red-500' },
  FILE_UPLOADED: { icon: Upload, label: 'File uploaded', color: 'text-purple-500' },
  FILE_VERSION_ADDED: { icon: RefreshCw, label: 'File version added', color: 'text-indigo-500' },
  STATUS_CHANGED: { icon: RefreshCw, label: 'Status changed', color: 'text-orange-500' },
  CLIENT_CREATED: { icon: UserPlus, label: 'Client created', color: 'text-green-500' },
  CLIENT_UPDATED: { icon: Edit, label: 'Client updated', color: 'text-blue-500' },
  COMMENT_ADDED: { icon: MessageSquare, label: 'Comment added', color: 'text-cyan-500' },
}

function getActivityDescription(activity: ActivityLog): string {
  const config = activityConfig[activity.type]
  const clientName = activity.client?.name ?? 'Unknown'
  const userName = activity.user?.name ?? 'Someone'

  switch (activity.type) {
    case 'PAYMENT_ADDED':
      return `${userName} recorded a payment for ${clientName}`
    case 'PAYMENT_UPDATED':
      return `${userName} updated a payment for ${clientName}`
    case 'PAYMENT_DELETED':
      return `${userName} deleted a payment for ${clientName}`
    case 'FILE_UPLOADED':
      return `${userName} uploaded a file for ${clientName}`
    case 'FILE_VERSION_ADDED':
      return `${userName} added a new version for ${clientName}`
    case 'STATUS_CHANGED':
      return `${userName} changed ${clientName}'s status`
    case 'CLIENT_CREATED':
      return `${userName} added client ${clientName}`
    case 'CLIENT_UPDATED':
      return `${userName} updated ${clientName}'s details`
    case 'COMMENT_ADDED':
      return `${userName} commented on ${clientName}'s file`
    default:
      return `${config.label} for ${clientName}`
  }
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No recent activity
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => {
              const config = activityConfig[activity.type]
              const Icon = config.icon
              const initials = activity.user?.name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) ?? '?'

              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                      <p className="text-sm text-foreground leading-snug">
                        {getActivityDescription(activity)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(activity.createdAt)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
