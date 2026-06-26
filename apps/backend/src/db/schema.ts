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
