import { TrendingUp, CheckCircle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface PaymentSummaryProps {
  totalDealAmount: number
  totalPaid: number
  remainingBalance: number
}

export function PaymentSummary({ totalDealAmount, totalPaid, remainingBalance }: PaymentSummaryProps) {
  const progress = totalDealAmount > 0 ? (totalPaid / totalDealAmount) * 100 : 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Payment Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Payment Progress</span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-primary" />
              Total Deal
            </div>
            <p className="text-lg font-bold text-foreground">{formatCurrency(totalDealAmount)}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle className="h-3 w-3 text-green-500" />
              Paid
            </div>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 text-orange-500" />
              Remaining
            </div>
            <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{formatCurrency(remainingBalance)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
