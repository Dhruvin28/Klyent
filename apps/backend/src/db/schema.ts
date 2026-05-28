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
    clientId: varchar('client_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
  },
  (table) => ({
    clientIdIdx: index('payments_client_id_idx').on(table.clientId),
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
    clientId: varchar('client_id', { length: 128 }).notNull(),
    shareToken: varchar('share_token', { length: 128 }).unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    clientIdIdx: index('files_client_id_idx').on(table.clientId),
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
