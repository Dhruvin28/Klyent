import {
  mysqlTable,
  varchar,
  text,
  decimal,
  timestamp,
  boolean,
  int,
  json,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core'

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    password: varchar('password', { length: 255 }).notNull(),
    role: mysqlEnum('role', ['ADMIN', 'MEMBER']).notNull().default('MEMBER'),
    companyName: varchar('company_name', { length: 255 }),
    companyLogoUrl: text('company_logo_url'),
    companyPhone: varchar('company_phone', { length: 50 }),
    companyAddress: text('company_address'),
    companyWebsite: varchar('company_website', { length: 500 }),
    companyGstin: varchar('company_gstin', { length: 20 }),
    passwordResetOtpHash: varchar('password_reset_otp_hash', { length: 255 }),
    passwordResetOtpExpiresAt: timestamp('password_reset_otp_expires_at'),
    studioIngestionKeyHash: varchar('studio_ingestion_key_hash', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  })
)

export const clients = mysqlTable(
  'clients',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: text('address'),
    projectDescription: text('project_description'),
    totalDealAmount: decimal('total_deal_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    status: mysqlEnum('status', ['ACTIVE', 'COMPLETED', 'ON_HOLD']).notNull().default('ACTIVE'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    userId: varchar('user_id', { length: 128 }).notNull(),
  },
  (table) => ({
    userIdIdx: index('clients_user_id_idx').on(table.userId),
    statusIdx: index('clients_status_idx').on(table.status),
  })
)

export const payments = mysqlTable(
  'payments',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    method: mysqlEnum('method', ['CASH', 'ONLINE', 'CHEQUE']).notNull(),
    date: timestamp('date').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    clientId: varchar('client_id', { length: 128 }),           // nullable — null for freelance payments
    freelanceProjectId: varchar('freelance_project_id', { length: 128 }), // null for client payments
    userId: varchar('user_id', { length: 128 }).notNull(),
  },
  (table) => ({
    clientIdIdx: index('payments_client_id_idx').on(table.clientId),
    freelanceProjectIdIdx: index('payments_freelance_project_id_idx').on(table.freelanceProjectId),
    userIdIdx: index('payments_user_id_idx').on(table.userId),
    dateIdx: index('payments_date_idx').on(table.date),
  })
)

export const files = mysqlTable(
  'files',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    description: text('description'),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    clientId: varchar('client_id', { length: 128 }),           // nullable — null for freelance files
    freelanceProjectId: varchar('freelance_project_id', { length: 128 }), // null for client files
    shareToken: varchar('share_token', { length: 128 }).unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    clientIdIdx: index('files_client_id_idx').on(table.clientId),
    freelanceProjectIdIdx: index('files_freelance_project_id_idx').on(table.freelanceProjectId),
    shareTokenIdx: uniqueIndex('files_share_token_idx').on(table.shareToken),
  })
)

export const fileVersions = mysqlTable(
  'file_versions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    versionNumber: int('version_number').notNull(),
    s3Key: varchar('s3_key', { length: 768 }).notNull(),
    s3Bucket: varchar('s3_bucket', { length: 255 }).notNull(),
    size: int('size').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    uploadedById: varchar('uploaded_by_id', { length: 128 }).notNull(),
    fileId: varchar('file_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    fileIdIdx: index('file_versions_file_id_idx').on(table.fileId),
    uploadedByIdx: index('file_versions_uploaded_by_idx').on(table.uploadedById),
  })
)

export const comments = mysqlTable(
  'comments',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    content: text('content').notNull(),
    fileId: varchar('file_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    fileIdIdx: index('comments_file_id_idx').on(table.fileId),
    userIdIdx: index('comments_user_id_idx').on(table.userId),
  })
)

export const activityLogs = mysqlTable(
  'activity_logs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    type: mysqlEnum('type', [
      'PAYMENT_ADDED',
      'PAYMENT_UPDATED',
      'PAYMENT_DELETED',
      'FILE_UPLOADED',
      'FILE_VERSION_ADDED',
      'STATUS_CHANGED',
      'CLIENT_CREATED',
      'CLIENT_UPDATED',
      'COMMENT_ADDED',
    ]).notNull(),
    metadata: json('metadata'),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    clientIdIdx: index('activity_logs_client_id_idx').on(table.clientId),
    userIdIdx: index('activity_logs_user_id_idx').on(table.userId),
    createdAtIdx: index('activity_logs_created_at_idx').on(table.createdAt),
  })
)

export const freelanceProjects = mysqlTable(
  'freelance_projects',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    clientName: varchar('client_name', { length: 200 }).notNull(),
    workType: varchar('work_type', { length: 200 }).notNull(),
    chargeType: varchar('charge_type', { length: 100 }).notNull(), // e.g. "hours", "pages", "sheets"
    rate: decimal('rate', { precision: 15, scale: 2 }).notNull(),
    status: mysqlEnum('status', ['ACTIVE', 'COMPLETED']).notNull().default('ACTIVE'),
    notes: text('notes'),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    userIdIdx: index('freelance_projects_user_id_idx').on(table.userId),
    statusIdx: index('freelance_projects_status_idx').on(table.status),
  })
)

export const proposals = mysqlTable(
  'proposals',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    proposalType: mysqlEnum('proposal_type', ['STANDARD', 'COST_BREAKUP']).notNull().default('STANDARD'),
    proposalNumber: varchar('proposal_number', { length: 100 }).notNull(),
    serviceType: varchar('service_type', { length: 200 }).notNull(),
    date: varchar('date', { length: 10 }).notNull(),
    validTill: varchar('valid_till', { length: 10 }).notNull(),
    clientName: varchar('client_name', { length: 200 }).notNull(),
    clientPhone: varchar('client_phone', { length: 50 }),
    clientEmail: varchar('client_email', { length: 255 }),
    clientAddress: text('client_address'),
    siteName: varchar('site_name', { length: 200 }),
    projectLocation: varchar('project_location', { length: 200 }),
    projectType: varchar('project_type', { length: 100 }),
    projectScope: varchar('project_scope', { length: 500 }),
    aboutCompany: text('about_company'),
    scopeOfWork: json('scope_of_work').$type<string[]>(),
    feesDescription: varchar('fees_description', { length: 500 }).notNull(),
    feesAmount: decimal('fees_amount', { precision: 15, scale: 2 }).notNull(),
    feesAmountInWords: varchar('fees_amount_in_words', { length: 500 }),
    feesNote: text('fees_note'),
    paymentMilestones: json('payment_milestones').$type<{ milestone: number; description: string; percentage: number; amount: number }[]>(),
    termsAndConditions: json('terms_and_conditions').$type<string[]>(),
    // COST_BREAKUP proposals only:
    materialSections: json('material_sections').$type<{ id: string; title: string; rateLabel: string; items: { srNo: number; description: string; rate?: string | null }[] }[]>(),
    costBreakupItems: json('cost_breakup_items').$type<{ item: string; description: string; amount: number }[]>(),
    status: mysqlEnum('status', ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).notNull().default('DRAFT'),
    shareToken: varchar('share_token', { length: 128 }).unique(),
    // Versioning: all versions of a proposal share the same rootProposalId
    // (which equals the id of the very first version). version starts at 1.
    version: int('version').notNull().default(1),
    rootProposalId: varchar('root_proposal_id', { length: 128 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    userIdIdx: index('proposals_user_id_idx').on(table.userId),
    statusIdx: index('proposals_status_idx').on(table.status),
    shareTokenIdx: uniqueIndex('proposals_share_token_idx').on(table.shareToken),
    rootProposalIdIdx: index('proposals_root_proposal_id_idx').on(table.rootProposalId),
  })
)

export const freelanceWorkLogs = mysqlTable(
  'freelance_work_logs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    freelanceProjectId: varchar('freelance_project_id', { length: 128 }).notNull(),
    description: text('description'),
    quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(), // quantity * rate
    date: timestamp('date').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    projectIdIdx: index('freelance_work_logs_project_id_idx').on(table.freelanceProjectId),
    dateIdx: index('freelance_work_logs_date_idx').on(table.date),
  })
)

// ---------------------------------------------------------------------
// Studio AI — WhatsApp project knowledge engine (ported from the
// "Interior Bot" / DesignAI prototype). Namespaced with `studio_` /
// `studio*` to avoid any collision with the freelancer-SaaS domain above.
// Every table is scoped by `userId` since Klyent is multi-tenant.
// ---------------------------------------------------------------------

export const studioProjects = mysqlTable(
  'studio_projects',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    clientName: varchar('client_name', { length: 200 }),
    siteAddress: text('site_address'),
    projectType: varchar('project_type', { length: 100 }),
    budget: decimal('budget', { precision: 15, scale: 2 }),
    timelineNotes: text('timeline_notes'),
    status: mysqlEnum('status', ['ACTIVE', 'ON_HOLD', 'COMPLETED']).notNull().default('ACTIVE'),
    // Optional link to an existing Klyent client — not required.
    clientId: varchar('client_id', { length: 128 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    userIdIdx: index('studio_projects_user_id_idx').on(table.userId),
    statusIdx: index('studio_projects_status_idx').on(table.status),
  })
)

export const studioWhatsappGroups = mysqlTable(
  'studio_whatsapp_groups',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    externalGroupId: varchar('external_group_id', { length: 255 }), // WhatsApp group id once a live bridge is wired up
    name: varchar('name', { length: 255 }).notNull(),
    groupType: varchar('group_type', { length: 50 }), // client | contractor | vendor | site | architect | internal
    projectId: varchar('project_id', { length: 128 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_whatsapp_groups_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_whatsapp_groups_project_id_idx').on(table.projectId),
    externalGroupIdIdx: uniqueIndex('studio_whatsapp_groups_external_id_idx').on(table.externalGroupId),
    nameUserIdx: index('studio_whatsapp_groups_name_user_idx').on(table.name, table.userId),
  })
)

export const studioMessages = mysqlTable(
  'studio_messages',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    source: varchar('source', { length: 50 }).notNull().default('whatsapp'), // whatsapp | manual_import
    groupId: varchar('group_id', { length: 128 }),
    groupName: varchar('group_name', { length: 255 }), // denormalized, kept even if the group row is deleted
    projectId: varchar('project_id', { length: 128 }),
    projectConfidence: decimal('project_confidence', { precision: 4, scale: 3 }),
    sender: varchar('sender', { length: 255 }),
    senderId: varchar('sender_id', { length: 255 }),
    messageType: varchar('message_type', { length: 20 }).notNull().default('text'), // text|image|pdf|docx|xlsx|voice|video|location|contact|link
    content: text('content'),
    replyToMessageId: varchar('reply_to_message_id', { length: 128 }),
    externalMessageId: varchar('external_message_id', { length: 255 }), // WhatsApp message id, for idempotency
    embedding: json('embedding').$type<number[]>(),
    timestamp: timestamp('timestamp').notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_messages_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_messages_project_id_idx').on(table.projectId),
    groupIdIdx: index('studio_messages_group_id_idx').on(table.groupId),
    timestampIdx: index('studio_messages_timestamp_idx').on(table.timestamp),
    externalIdIdx: uniqueIndex('studio_messages_external_id_idx').on(table.externalMessageId),
  })
)

export const studioMessageMedia = mysqlTable(
  'studio_message_media',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    messageId: varchar('message_id', { length: 128 }).notNull(),
    fileName: varchar('file_name', { length: 500 }),
    mimeType: varchar('mime_type', { length: 255 }),
    storageUrl: text('storage_url').notNull(),
    mediaKind: varchar('media_kind', { length: 20 }), // image | audio | video | document
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    messageIdIdx: index('studio_message_media_message_id_idx').on(table.messageId),
  })
)

export const studioDocuments = mysqlTable(
  'studio_documents',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    projectId: varchar('project_id', { length: 128 }),
    projectConfidence: decimal('project_confidence', { precision: 4, scale: 3 }),
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }),
    storageUrl: text('storage_url').notNull(),
    extractedText: text('extracted_text'),
    documentType: varchar('document_type', { length: 50 }), // boq|quotation|invoice|purchase_order|floor_plan|...|other
    ocrUsed: boolean('ocr_used').notNull().default(false),
    uploadedBy: varchar('uploaded_by', { length: 255 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_documents_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_documents_project_id_idx').on(table.projectId),
  })
)

export const studioDocumentChunks = mysqlTable(
  'studio_document_chunks',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    documentId: varchar('document_id', { length: 128 }).notNull(),
    chunkIndex: int('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: json('embedding').$type<number[]>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    documentIdIdx: index('studio_document_chunks_document_id_idx').on(table.documentId),
  })
)

export const studioDecisions = mysqlTable(
  'studio_decisions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    projectId: varchar('project_id', { length: 128 }),
    topic: varchar('topic', { length: 500 }).notNull(),
    decision: text('decision').notNull(),
    decisionBy: varchar('decision_by', { length: 255 }),
    decisionDate: timestamp('decision_date'),
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    sourceDocumentId: varchar('source_document_id', { length: 128 }),
    confidence: decimal('confidence', { precision: 4, scale: 3 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_decisions_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_decisions_project_id_idx').on(table.projectId),
  })
)

export const studioTasks = mysqlTable(
  'studio_tasks',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    projectId: varchar('project_id', { length: 128 }),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    assignedTo: varchar('assigned_to', { length: 255 }),
    priority: mysqlEnum('priority', ['low', 'medium', 'high']).notNull().default('medium'),
    status: mysqlEnum('status', ['open', 'in_progress', 'done', 'cancelled']).notNull().default('open'),
    dueDate: timestamp('due_date'),
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_tasks_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_tasks_project_id_idx').on(table.projectId),
    statusIdx: index('studio_tasks_status_idx').on(table.status),
  })
)

export const studioDeadlines = mysqlTable(
  'studio_deadlines',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    projectId: varchar('project_id', { length: 128 }),
    description: text('description').notNull(),
    dueDate: timestamp('due_date'),
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_deadlines_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_deadlines_project_id_idx').on(table.projectId),
  })
)

export const studioVendors = mysqlTable(
  'studio_vendors',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    contactInfo: text('contact_info'),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_vendors_user_id_idx').on(table.userId),
    nameUserIdx: uniqueIndex('studio_vendors_name_user_idx').on(table.name, table.userId),
  })
)

export const studioMaterials = mysqlTable(
  'studio_materials',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_materials_user_id_idx').on(table.userId),
  })
)

export const studioQuotes = mysqlTable(
  'studio_quotes',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    projectId: varchar('project_id', { length: 128 }),
    vendorId: varchar('vendor_id', { length: 128 }),
    materialId: varchar('material_id', { length: 128 }),
    description: text('description'),
    price: decimal('price', { precision: 15, scale: 2 }),
    unit: varchar('unit', { length: 50 }), // sqft|piece|lumpsum|...
    status: mysqlEnum('status', ['quoted', 'revised', 'approved', 'rejected']).notNull().default('quoted'),
    quoteDate: timestamp('quote_date'),
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    sourceDocumentId: varchar('source_document_id', { length: 128 }),
    confidence: decimal('confidence', { precision: 4, scale: 3 }),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('studio_quotes_user_id_idx').on(table.userId),
    projectIdIdx: index('studio_quotes_project_id_idx').on(table.projectId),
  })
)

export const invoices = mysqlTable(
  'invoices',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    invoiceDate: varchar('invoice_date', { length: 10 }).notNull(),
    dueDate: varchar('due_date', { length: 10 }).notNull(),

    // Buyer ("Bill To"). clientId is optional — an invoice can be raised for a
    // one-off buyer who is not a saved client. Details are snapshotted either
    // way so editing a client later never rewrites an issued invoice.
    clientId: varchar('client_id', { length: 128 }),
    clientName: varchar('client_name', { length: 200 }).notNull(),
    clientPhone: varchar('client_phone', { length: 50 }),
    clientEmail: varchar('client_email', { length: 255 }),
    clientAddress: text('client_address'),
    clientGstin: varchar('client_gstin', { length: 20 }),

    // GST place-of-supply. Same state code => CGST + SGST, different => IGST.
    supplierStateCode: varchar('supplier_state_code', { length: 2 }),
    supplierStateName: varchar('supplier_state_name', { length: 100 }),
    placeOfSupplyCode: varchar('place_of_supply_code', { length: 2 }),
    placeOfSupplyName: varchar('place_of_supply_name', { length: 100 }),
    isInterState: boolean('is_inter_state').notNull().default(false),

    lineItems: json('line_items').$type<
      {
        id: string
        description: string
        hsnSac?: string | null
        quantity: number
        unit?: string | null
        rate: number
        discountPercent: number
        taxRate: number
      }[]
    >(),

    // Server-computed totals, stored so an issued invoice is immutable history.
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    discountTotal: decimal('discount_total', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    totalTax: decimal('total_tax', { precision: 15, scale: 2 }).notNull().default('0'),
    roundOff: decimal('round_off', { precision: 15, scale: 2 }).notNull().default('0'),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    amountInWords: varchar('amount_in_words', { length: 500 }),

    // Payments are not linked to invoices (see notes); amountPaid is recorded
    // by hand so an invoice can still show a balance and a PART_PAID status.
    amountPaid: decimal('amount_paid', { precision: 15, scale: 2 }).notNull().default('0'),

    notes: text('notes'),
    termsAndConditions: json('terms_and_conditions').$type<string[]>(),
    bankName: varchar('bank_name', { length: 200 }),
    bankAccountName: varchar('bank_account_name', { length: 200 }),
    bankAccountNumber: varchar('bank_account_number', { length: 50 }),
    bankIfsc: varchar('bank_ifsc', { length: 20 }),
    upiId: varchar('upi_id', { length: 100 }),

    status: mysqlEnum('status', ['DRAFT', 'SENT', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    shareToken: varchar('share_token', { length: 128 }).unique(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    userIdIdx: index('invoices_user_id_idx').on(table.userId),
    statusIdx: index('invoices_status_idx').on(table.status),
    clientIdIdx: index('invoices_client_id_idx').on(table.clientId),
    shareTokenIdx: uniqueIndex('invoices_share_token_idx').on(table.shareToken),
    numberIdx: index('invoices_number_idx').on(table.invoiceNumber),
  })
)
