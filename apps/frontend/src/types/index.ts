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
export type ProposalType = 'STANDARD' | 'COST_BREAKUP'

export interface PaymentMilestone {
  milestone: number
  description: string
  percentage: number
  amount: number
}

export interface MaterialItem {
  srNo: number
  description: string
  rate?: string | null
}

export interface MaterialSection {
  id: string
  title: string
  rateLabel: string
  items: MaterialItem[]
}

export interface CostBreakupItem {
  item: string
  description: string
  amount: number
}

export interface Proposal {
  id: string
  proposalType: ProposalType
  materialSections?: MaterialSection[] | null
  costBreakupItems?: CostBreakupItem[] | null
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

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PART_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'

export interface InvoiceLineItem {
  id: string
  description: string
  hsnSac?: string | null
  quantity: number
  unit?: string | null
  rate: number
  discountPercent: number
  taxRate: number
}

export interface Invoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string

  clientId?: string | null
  clientName: string
  clientPhone?: string | null
  clientEmail?: string | null
  clientAddress?: string | null
  clientGstin?: string | null

  supplierStateCode?: string | null
  supplierStateName?: string | null
  placeOfSupplyCode?: string | null
  placeOfSupplyName?: string | null
  isInterState: boolean

  lineItems?: InvoiceLineItem[] | null

  subtotal: number
  discountTotal: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalTax: number
  roundOff: number
  totalAmount: number
  amountInWords?: string | null
  amountPaid: number
  balanceDue: number

  notes?: string | null
  termsAndConditions?: string[] | null
  bankName?: string | null
  bankAccountName?: string | null
  bankAccountNumber?: string | null
  bankIfsc?: string | null
  upiId?: string | null

  status: InvoiceStatus
  shareToken?: string | null
  userId: string
  createdAt: string
  updatedAt: string
  // joined from user
  companyName?: string | null
  companyLogoUrl?: string | null
  companyPhone?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
  companyGstin?: string | null
}

export interface InvoiceSummary {
  billed: number
  collected: number
  outstanding: number
}

// ── Business report (dashboard export) ──────────────────────
export interface ReportCompany {
  name: string
  email: string
  companyName?: string | null
  companyLogoUrl?: string | null
  companyPhone?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
  companyGstin?: string | null
}

export interface ReportClientRow {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  status: ClientStatus
  projectDescription?: string | null
  totalDealAmount: number
  totalPaid: number
  pending: number
  paymentCount: number
  lastPaymentDate?: string | null
  createdAt: string
}

export interface ReportPaymentRow {
  id: string
  amount: number
  method: PaymentMethod
  date: string
  notes?: string | null
  counterparty: string
  source: 'CLIENT' | 'FREELANCE' | 'OTHER'
  workType?: string | null
}

export interface ReportFreelanceRow {
  id: string
  clientName: string
  workType: string
  chargeType: string
  rate: number
  status: FreelanceStatus
  billed: number
  paid: number
  pending: number
  createdAt: string
}

export interface ReportSummary {
  totalClients: number
  activeClients: number
  completedClients: number
  onHoldClients: number
  totalDealValue: number
  totalRevenue: number
  pendingPayments: number
  totalReceived: number
  paymentCount: number
  freelanceProjects: number
  freelanceActiveProjects: number
  freelanceBilled: number
  freelancePaid: number
  freelancePending: number
  invoiceCount: number
  invoiceBilled: number
  invoiceCollected: number
  invoiceOutstanding: number
  proposalCount: number
  proposalsByStatus: Record<string, number>
}

export interface BusinessReport {
  generatedAt: string
  company: ReportCompany | null
  summary: ReportSummary
  clients: ReportClientRow[]
  payments: ReportPaymentRow[]
  freelanceProjects: ReportFreelanceRow[]
  paymentMethods: { method: string; count: number; total: number }[]
  monthlyRevenue: { month: number; year: number; total: number }[]
}
