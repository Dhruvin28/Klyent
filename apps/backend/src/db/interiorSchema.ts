import { mysqlTable, varchar, text, timestamp, boolean, int, json, mysqlEnum, index, uniqueIndex, customType } from 'drizzle-orm/mysql-core'

// ── Interior 3D (dimension-preserving drawing → 3D reconstruction) ──
// See Klyent_2D_to_3D_Interior_Implementation_Plan.md. Drawings are evidence; a
// revision's `scene` is the canonical, versioned source of truth (the designer Plan
// plus property-level evidence, constraints and assumptions). Renders and designer
// projects are derived from an exact revision.

const longblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'longblob'
  },
})

export const intWorkspaces = mysqlTable(
  'int_workspaces',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    clientId: varchar('client_id', { length: 128 }),
    name: varchar('name', { length: 255 }).notNull(),
    mode: mysqlEnum('mode', ['strict', 'draft']).notNull().default('strict'),
    referencePageId: varchar('reference_page_id', { length: 128 }),
    latestRevisionId: varchar('latest_revision_id', { length: 128 }),
    approvedRevisionId: varchar('approved_revision_id', { length: 128 }),
    designProjectId: varchar('design_project_id', { length: 128 }),
    designerPushedRevision: int('designer_pushed_revision'),
    autoBuild: boolean('auto_build').notNull().default(true),
    lockVersion: int('lock_version').notNull().default(0),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    userIdx: index('int_workspaces_user_idx').on(table.userId),
  })
)

export const intDocuments = mysqlTable(
  'int_documents',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    kind: mysqlEnum('kind', ['pdf', 'image', 'dxf']).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    size: int('size').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    revisionLabel: varchar('revision_label', { length: 64 }),
    pageCount: int('page_count').notNull().default(0),
    status: varchar('status', { length: 24 }).notNull().default('uploaded'),
    preflight: json('preflight'),
    error: text('error'),
    data: longblob('data').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('int_documents_workspace_idx').on(table.workspaceId),
    userIdx: index('int_documents_user_idx').on(table.userId),
  })
)

export const intPages = mysqlTable(
  'int_pages',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    documentId: varchar('document_id', { length: 128 }).notNull(),
    pageIndex: int('page_index').notNull(),
    width: int('width').notNull(),
    height: int('height').notNull(),
    previewWidth: int('preview_width').notNull(),
    previewHeight: int('preview_height').notNull(),
    role: varchar('role', { length: 32 }),
    suggestedRole: varchar('suggested_role', { length: 32 }),
    title: varchar('title', { length: 255 }),
    status: varchar('status', { length: 24 }).notNull().default('extracted'),
    extraction: json('extraction').notNull(),
    vectors: longblob('vectors'),
    image: longblob('image').notNull(),
    preview: longblob('preview').notNull(),
    interpretation: json('interpretation'),
    interpretationKey: varchar('interpretation_key', { length: 64 }),
    interpretationMeta: json('interpretation_meta'),
    calibration: json('calibration'),
    assignment: json('assignment'),
    registration: json('registration'),
    error: text('error'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    documentPageIdx: uniqueIndex('int_pages_document_page_idx').on(table.documentId, table.pageIndex),
    workspaceIdx: index('int_pages_workspace_idx').on(table.workspaceId),
  })
)

export const intJobs = mysqlTable(
  'int_jobs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    targetId: varchar('target_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 191 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('queued'),
    attempt: int('attempt').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    leaseToken: varchar('lease_token', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { fsp: 3 }),
    availableAt: timestamp('available_at', { fsp: 3 }).notNull().defaultNow(),
    cancelRequestedAt: timestamp('cancel_requested_at', { fsp: 3 }),
    progress: json('progress'),
    input: json('input'),
    result: json('result'),
    errorCode: varchar('error_code', { length: 64 }),
    error: text('error'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { fsp: 3 }),
    finishedAt: timestamp('finished_at', { fsp: 3 }),
  },
  (table) => ({
    idemIdx: uniqueIndex('int_jobs_idem_idx').on(table.userId, table.idempotencyKey),
    statusIdx: index('int_jobs_status_idx').on(table.status, table.availableAt),
    workspaceIdx: index('int_jobs_workspace_idx').on(table.workspaceId, table.createdAt),
  })
)

export const intRevisions = mysqlTable(
  'int_revisions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionNo: int('revision_no').notNull(),
    parentRevisionId: varchar('parent_revision_id', { length: 128 }),
    origin: varchar('origin', { length: 24 }).notNull(),
    status: mysqlEnum('status', ['draft', 'frozen']).notNull().default('draft'),
    schemaVersion: varchar('schema_version', { length: 32 }).notNull(),
    scene: json('scene').notNull(),
    sceneHash: varchar('scene_hash', { length: 64 }),
    summary: json('summary'),
    lockVersion: int('lock_version').notNull().default(0),
    sealedAt: timestamp('sealed_at', { fsp: 3 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    noIdx: uniqueIndex('int_revisions_no_idx').on(table.workspaceId, table.revisionNo),
    userIdx: index('int_revisions_user_idx').on(table.userId),
  })
)

export const intValidationRuns = mysqlTable(
  'int_validation_runs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: varchar('revision_id', { length: 128 }).notNull(),
    sceneHash: varchar('scene_hash', { length: 64 }).notNull(),
    validatorVersion: varchar('validator_version', { length: 32 }).notNull(),
    policy: json('policy').notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    summary: json('summary').notNull(),
    checks: json('checks').notNull(),
    issues: json('issues').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    revisionIdx: index('int_validation_runs_revision_idx').on(table.revisionId, table.createdAt),
  })
)

export const intDecisions = mysqlTable(
  'int_decisions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: varchar('revision_id', { length: 128 }),
    kind: varchar('kind', { length: 48 }).notNull(),
    target: json('target'),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    command: json('command'),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('int_decisions_workspace_idx').on(table.workspaceId, table.createdAt),
  })
)

export const intApprovals = mysqlTable(
  'int_approvals',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: varchar('revision_id', { length: 128 }).notNull(),
    validationRunId: varchar('validation_run_id', { length: 128 }).notNull(),
    sceneHash: varchar('scene_hash', { length: 64 }).notNull(),
    mode: mysqlEnum('mode', ['final', 'draft']).notNull(),
    note: text('note'),
    approvedAt: timestamp('approved_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    revisionIdx: index('int_approvals_revision_idx').on(table.revisionId),
  })
)

export const intRenderSets = mysqlTable(
  'int_render_sets',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 128 }).notNull(),
    revisionId: varchar('revision_id', { length: 128 }).notNull(),
    approvalId: varchar('approval_id', { length: 128 }),
    designProjectId: varchar('design_project_id', { length: 128 }).notNull(),
    manifest: json('manifest').notNull(),
    manifestHash: varchar('manifest_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('queued'),
    outputs: json('outputs').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    workspaceIdx: index('int_render_sets_workspace_idx').on(table.workspaceId, table.createdAt),
  })
)
