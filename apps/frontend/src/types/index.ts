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

// ---------------------------------------------------------------------
// Studio AI — WhatsApp project knowledge engine
// ---------------------------------------------------------------------

export type StudioProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'

export interface StudioProject {
  id: string
  name: string
  clientName?: string | null
  siteAddress?: string | null
  projectType?: string | null
  budget?: string | null
  timelineNotes?: string | null
  status: StudioProjectStatus
  clientId?: string | null
  createdAt: string
  updatedAt: string
}

export interface StudioMessage {
  id: string
  source: string
  groupName?: string | null
  projectId?: string | null
  sender?: string | null
  messageType: string
  content?: string | null
  timestamp: string
  createdAt: string
}

export interface StudioDocument {
  id: string
  projectId?: string | null
  fileName: string
  mimeType?: string | null
  storageUrl: string
  extractedText?: string | null
  documentType?: string | null
  ocrUsed: boolean
  createdAt: string
}

export interface StudioTask {
  id: string
  projectId?: string | null
  title: string
  description?: string | null
  assignedTo?: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  dueDate?: string | null
  createdAt: string
}

export interface StudioDecision {
  id: string
  projectId?: string | null
  topic: string
  decision: string
  decisionBy?: string | null
  createdAt: string
}

export interface StudioQuote {
  id: string
  projectId?: string | null
  description?: string | null
  price?: string | null
  unit?: string | null
  status: 'quoted' | 'revised' | 'approved' | 'rejected'
  vendorName?: string | null
  materialName?: string | null
  createdAt: string
}

export interface StudioAskSource {
  kind: string
  id: string
  label: string
  excerpt: string
}

export interface StudioAskResponse {
  answer: string
  sources: StudioAskSource[]
}

export interface StudioImportResult {
  totalLines: number
  messagesIngested: number
  mediaAttached: number
  skippedSystemMessages: number
  errors: string[]
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

// ---------------------------------------------------------------------
// Procurement — vendors, price lists, quote comparison, purchase orders
// ---------------------------------------------------------------------

export interface Vendor {
  id: string
  name: string
  contactInfo?: string | null
  phone?: string | null
  email?: string | null
  gstin?: string | null
  address?: string | null
  category?: string | null
  notes?: string | null
  createdAt: string
  productCount: number
  quoteCount: number
  orderCount: number
  totalOrdered: number
  totalPaid: number
  balanceDue: number
}

export type VendorProductSource = 'designer' | 'import' | 'vendor'

export interface VendorProduct {
  id: string
  vendorId: string
  vendorName: string
  vendorPhone?: string | null
  name: string
  brand?: string | null
  sku?: string | null
  category?: string | null
  unit: string
  price: number
  gstRate: number
  hsnCode?: string | null
  description?: string | null
  leadTimeDays?: number | null
  minOrderQty?: number | null
  isActive: boolean
  source: VendorProductSource
  priceUpdatedAt: string
  createdAt: string
  updatedAt: string
}

export interface VendorProductPrice {
  price: number
  recordedAt: string
}

export type ProcurementItemStatus = 'open' | 'approved' | 'ordered' | 'received' | 'cancelled'
export type ProcurementQuoteSource = 'whatsapp' | 'document' | 'catalog' | 'manual'

export interface ProcurementQuote {
  id: string
  itemId?: string | null
  projectId?: string | null
  vendorId?: string | null
  vendorName?: string | null
  vendorPhone?: string | null
  vendorGstin?: string | null
  productId?: string | null
  productName?: string | null
  productBrand?: string | null
  materialName?: string | null
  description?: string | null
  price: number | null
  unit?: string | null
  gstRate: number | null
  leadTimeDays?: number | null
  validTill?: string | null
  notes?: string | null
  status: 'quoted' | 'revised' | 'approved' | 'rejected'
  quoteDate?: string | null
  confidence: number | null
  source: ProcurementQuoteSource
  createdAt: string
}

export interface ProcurementItem {
  id: string
  projectId?: string | null
  projectName?: string | null
  title: string
  category?: string | null
  specification?: string | null
  quantity: number
  unit: string
  clientRate: number | null
  neededBy?: string | null
  status: ProcurementItemStatus
  approvedQuoteId?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  // list view
  quoteCount?: number
  lowestPrice?: number | null
  lowestVendorName?: string | null
  highestPrice?: number | null
  approvedQuote?: ProcurementQuote | null
}

export interface ProcurementItemOrderRef {
  id: string
  poNumber: string
  status: PurchaseOrderStatus
  vendorName: string
  quantity: number
  receivedQuantity: number
}

export interface ProcurementItemDetail extends ProcurementItem {
  quotes: ProcurementQuote[]
  orders: ProcurementItemOrderRef[]
}

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'

export interface PurchaseOrderLine {
  id: string
  itemId?: string | null
  productId?: string | null
  description: string
  hsnSac?: string | null
  quantity: number
  unit?: string | null
  rate: number
  discountPercent: number
  taxRate: number
  receivedQuantity: number
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  poDate: string
  expectedDelivery?: string | null
  projectId?: string | null
  projectName?: string | null

  vendorId: string
  vendorName: string
  vendorPhone?: string | null
  vendorEmail?: string | null
  vendorAddress?: string | null
  vendorGstin?: string | null

  deliveryAddress?: string | null
  supplierStateCode?: string | null
  supplierStateName?: string | null
  placeOfSupplyCode?: string | null
  placeOfSupplyName?: string | null
  isInterState: boolean

  lineItems?: PurchaseOrderLine[] | null

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
  // Not sent on the vendor's shared view.
  amountPaid?: number
  balanceDue?: number

  notes?: string | null
  termsAndConditions?: string[] | null
  status: PurchaseOrderStatus
  shareToken?: string | null
  vendorAcknowledgedAt?: string | null
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

export interface PurchaseOrderSummary {
  ordered: number
  paid: number
  outstanding: number
}

export interface ProcurementSummary {
  budget: number | null
  items: { total: number; open: number; approved: number; ordered: number; received: number }
  approvedCost: number
  clientValue: number
  margin: number
  marginPercent: number | null
  itemsWithoutClientRate: number
  savings: number
  orders: { count: number; committed: number; paid: number; outstanding: number; awaitingDelivery: number }
}
