import { useState } from 'react'
import { IndianRupee, Users, Clock, TrendingUp } from 'lucide-react'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RevenueChart } from '@/components/dashboard/RevenueChart'
import { ClientGrowthChart } from '@/components/dashboard/ClientGrowthChart'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { DashboardDetailModal, type DashboardTile } from '@/components/dashboard/DashboardDetailModal'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useDashboardStats } from '@/hooks/useDashboard'
import { useAuthStore } from '@/store/auth.store'
import { formatCurrency } from '@/lib/utils'

export function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats()
  const user = useAuthStore((s) => s.user)
  const [activeTile, setActiveTile] = useState<DashboardTile | null>(null)

  const hasCompany = !!(user?.companyName || user?.companyLogoUrl)
  const companyInitials = user?.companyName?.slice(0, 2).toUpperCase() ?? 'CO'

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
      {/* Company banner */}
      {hasCompany && (
        <div className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4">
          <Avatar className="h-12 w-12 rounded-lg shrink-0">
            {user?.companyLogoUrl && (
              <AvatarImage src={user.companyLogoUrl} alt={user.companyName ?? 'Logo'} className="object-contain p-0.5" />
            )}
            <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              {companyInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{user?.companyName}</p>
            {user?.companyWebsite && (
              <a
                href={user.companyWebsite}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary truncate block"
              >
                {user.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          icon={IndianRupee}
          label="Total Revenue"
          value={formatCurrency(stats?.totalRevenue ?? 0)}
          iconClassName="bg-green-100 dark:bg-green-900/30"
          onClick={() => setActiveTile('revenue')}
        />
        <StatsCard
          icon={Users}
          label="Total Clients"
          value={stats?.totalClients ?? 0}
          iconClassName="bg-blue-100 dark:bg-blue-900/30"
          onClick={() => setActiveTile('clients')}
        />
        <StatsCard
          icon={Clock}
          label="Pending Payments"
          value={formatCurrency(stats?.pendingPayments ?? 0)}
          iconClassName="bg-orange-100 dark:bg-orange-900/30"
          onClick={() => setActiveTile('pending')}
        />
        <StatsCard
          icon={TrendingUp}
          label="Active Clients"
          value={stats?.activeClients ?? 0}
          iconClassName="bg-purple-100 dark:bg-purple-900/30"
          onClick={() => setActiveTile('active')}
        />
      </div>

      {/* Revenue chart */}
      <RevenueChart data={stats?.monthlyRevenue ?? []} />

      {/* Growth + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ClientGrowthChart data={stats?.clientGrowth ?? []} />
        <RecentActivity activities={stats?.recentActivity ?? []} />
      </div>

      {/* Detail modal */}
      <DashboardDetailModal
        tile={activeTile}
        stats={stats}
        onClose={() => setActiveTile(null)}
      />
    </div>
  )
}
