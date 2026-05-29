import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatsCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  change?: {
    value: number
    label: string
  }
  className?: string
  iconClassName?: string
  onClick?: () => void
}

export function StatsCard({ icon: Icon, label, value, change, className, iconClassName, onClick }: StatsCardProps) {
  const isPositive = change && change.value >= 0

  return (
    <Card
      className={cn('', onClick && 'cursor-pointer hover:shadow-md transition-shadow', className)}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-muted', iconClassName)}>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {change && (
          <div className={cn(
            'flex items-center gap-1 text-xs mt-1',
            isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          )}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>{Math.abs(change.value)}% {change.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
