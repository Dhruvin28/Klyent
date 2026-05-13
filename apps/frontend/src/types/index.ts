export type Role = 'ADMIN' | 'MEMBER'
export type ClientStatus = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD'
export type PaymentMethod = 'CASH' | 'ONLINE' | 'CHEQUE'
export type ActivityType =
  | 'PAYMENT_ADDED'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_DELETED'
  | 'FILE_UPLOADED'
  | 'FILE_VERSION_ADDED'
  | 'STATUS_CHANGED'
  | 'CLIENT_CREATED'
  | 'CLIENT_UPDATED'
  | 'COMMENT_ADDED'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  createdAt: string
}

export interface Client {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  projectDescription?: string
  totalDealAmount: number
  status: ClientStatus
  createdAt: string
  updatedAt: string
  totalPaid?: number
  remainingBalance?: number
  _count?: { payments: number; files: number }
}

export interface Payment {
  id: string
  amount: number
  method: PaymentMethod
  date: string
  notes?: string
  createdAt: string
  clientId: string
  client?: Pick<Client, 'id' | 'name'>
  user?: Pick<User, 'id' | 'name'>
}

export interface File {
  id: string
  name: string
  mimeType: string
  clientId: string
  shareToken?: string
  createdAt: string
  latestVersion?: FileVersion
  _count?: { versions: number; comments: number }
}

export interface FileVersion {
  id: string
  versionNumber: number
  size: number
  isActive: boolean
  createdAt: string
  uploadedBy?: Pick<User, 'id' | 'name'>
}

export interface Comment {
  id: string
  content: string
  createdAt: string
  user: Pick<User, 'id' | 'name'>
}

export interface ActivityLog {
  id: string
  type: ActivityType
  metadata?: Record<string, unknown>
  createdAt: string
  user: Pick<User, 'id' | 'name'>
  client: Pick<Client, 'id' | 'name'>
}

export interface DashboardStats {
  totalRevenue: number
  totalClients: number
  activeClients: number
  completedClients: number
  onHoldClients: number
  pendingPayments: number
  monthlyRevenue: { month: number; year: number; total: number }[]
  clientGrowth: { month: number; year: number; count: number }[]
  recentActivity: ActivityLog[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AuthResponse {
  token: string
  user: User
}
