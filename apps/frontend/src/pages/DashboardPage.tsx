import { IndianRupee, Users, Clock, TrendingUp } from 'lucide-react'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RevenueChart } from '@/components/dashboard/RevenueChart'
import { ClientGrowthChart } from '@/components/dashboard/ClientGrowthChart'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useDashboardStats } from '@/hooks/useDashboard'
import { formatCurrency } from '@/lib/utils'

export function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          icon={IndianRupee}
          label="Total Revenue"
          value={formatCurrency(stats?.totalRevenue ?? 0)}
          iconClassName="bg-green-100 dark:bg-green-900/30"
        />
        <StatsCard
          icon={Users}
          label="Total Clients"
          value={stats?.totalClients ?? 0}
          iconClassName="bg-blue-100 dark:bg-blue-900/30"
        />
        <StatsCard
          icon={Clock}
          label="Pending Payments"
          value={formatCurrency(stats?.pendingPayments ?? 0)}
          iconClassName="bg-orange-100 dark:bg-orange-900/30"
        />
        <StatsCard
          icon={TrendingUp}
          label="Active Clients"
          value={stats?.activeClients ?? 0}
          iconClassName="bg-purple-100 dark:bg-purple-900/30"
        />
      </div>

      {/* Revenue chart */}
      <RevenueChart data={stats?.monthlyRevenue ?? []} />

      {/* Growth + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ClientGrowthChart data={stats?.clientGrowth ?? []} />
        <RecentActivity activities={stats?.recentActivity ?? []} />
      </div>
    </div>
  )
}
