export type Role = 'ADMIN' | 'MEMBER'
export type ClientStatus = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD'
export type PaymentMethod = 'CASH' | 'ONLINE' | 'CHEQUE'
export type FreelanceStatus = 'ACTIVE' | 'COMPLETED'
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
  companyName?: string | null
  companyLogoUrl?: string | null
  companyPhone?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
  companyGstin?: string | null
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
  clientId?: string | null
  freelanceProjectId?: string | null
  client?: Pick<Client, 'id' | 'name'> | null
  freelanceProject?: { id: string; clientName: string; workType: string } | null
  user?: Pick<User, 'id' | 'name'>
}

export interface File {
  id: string
  name: string
  description?: string | null
  mimeType: string
  clientId?: string | null
  freelanceProjectId?: string | null
  shareToken?: string
  createdAt: string
  latestVersion?: FileVersion
  versions?: (FileVersion & { uploadedBy?: Pick<User, 'id' | 'name'> })[]
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
  freelanceBilled: number
  freelancePaid: number
  freelancePending: number
  freelanceActiveProjects: number
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

export interface FreelanceProject {
  id: string
  clientName: string
  workType: string
  chargeType: string
  rate: number
  status: FreelanceStatus
  notes?: string | null
  userId: string
  createdAt: string
  updatedAt: string
  // computed stats
  totalBilled: number
  totalPaid: number
  remainingBalance: number
  workLogs?: FreelanceWorkLog[]
}

export type ProposalStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED'

export interface PaymentMilestone {
  milestone: number
  description: string
  percentage: number
  amount: number
}

export interface Proposal {
  id: string
  proposalNumber: string
  serviceType: string
  date: string
  validTill: string
  clientName: string
  clientPhone?: string | null
  clientEmail?: string | null
  clientAddress?: string | null
  siteName?: string | null
  projectLocation?: string | null
  projectType?: string | null
  projectScope?: string | null
  aboutCompany?: string | null
  scopeOfWork?: string[] | null
  feesDescription: string
  feesAmount: number
  feesAmountInWords?: string | null
  feesNote?: string | null
  paymentMilestones?: PaymentMilestone[] | null
  termsAndConditions?: string[] | null
  status: ProposalStatus
  shareToken?: string | null
  version: number
  rootProposalId?: string | null
  userId: string
  createdAt: string
  updatedAt: string
  // joined from user
  companyName?: string | null
  companyLogoUrl?: string | null
  companyPhone?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
}

export interface FreelanceWorkLog {
  id: string
  freelanceProjectId: string
  description?: string | null
  quantity: number
  amount: number
  date: string
  createdAt: string
  updatedAt: string
}
