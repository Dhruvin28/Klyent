import mysql from 'mysql2/promise'

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`email\` VARCHAR(255) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`password\` VARCHAR(255) NOT NULL,
    \`role\` ENUM('ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`users_email_idx\` (\`email\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`clients\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(200) NOT NULL,
    \`email\` VARCHAR(255),
    \`phone\` VARCHAR(50),
    \`address\` TEXT,
    \`project_description\` TEXT,
    \`total_deal_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`status\` ENUM('ACTIVE','COMPLETED','ON_HOLD') NOT NULL DEFAULT 'ACTIVE',
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    \`user_id\` VARCHAR(128) NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`clients_user_id_idx\` (\`user_id\`),
    INDEX \`clients_status_idx\` (\`status\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`payments\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`amount\` DECIMAL(15,2) NOT NULL,
    \`method\` ENUM('CASH','ONLINE','CHEQUE') NOT NULL,
    \`date\` TIMESTAMP NOT NULL,
    \`notes\` TEXT,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    \`client_id\` VARCHAR(128),
    \`freelance_project_id\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`payments_client_id_idx\` (\`client_id\`),
    INDEX \`payments_freelance_project_id_idx\` (\`freelance_project_id\`),
    INDEX \`payments_user_id_idx\` (\`user_id\`),
    INDEX \`payments_date_idx\` (\`date\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`files\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(500) NOT NULL,
    \`description\` TEXT,
    \`mime_type\` VARCHAR(255) NOT NULL,
    \`client_id\` VARCHAR(128),
    \`freelance_project_id\` VARCHAR(128),
    \`share_token\` VARCHAR(128),
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`files_share_token_idx\` (\`share_token\`),
    INDEX \`files_client_id_idx\` (\`client_id\`),
    INDEX \`files_freelance_project_id_idx\` (\`freelance_project_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`file_versions\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`version_number\` INT NOT NULL,
    \`s3_key\` VARCHAR(768) NOT NULL,
    \`s3_bucket\` VARCHAR(255) NOT NULL,
    \`size\` INT NOT NULL,
    \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
    \`uploaded_by_id\` VARCHAR(128) NOT NULL,
    \`file_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`file_versions_file_id_idx\` (\`file_id\`),
    INDEX \`file_versions_uploaded_by_idx\` (\`uploaded_by_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`comments\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`content\` TEXT NOT NULL,
    \`file_id\` VARCHAR(128) NOT NULL,
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`comments_file_id_idx\` (\`file_id\`),
    INDEX \`comments_user_id_idx\` (\`user_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`activity_logs\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`type\` ENUM('PAYMENT_ADDED','PAYMENT_UPDATED','PAYMENT_DELETED','FILE_UPLOADED','FILE_VERSION_ADDED','STATUS_CHANGED','CLIENT_CREATED','CLIENT_UPDATED','COMMENT_ADDED') NOT NULL,
    \`metadata\` JSON,
    \`client_id\` VARCHAR(128) NOT NULL,
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`activity_logs_client_id_idx\` (\`client_id\`),
    INDEX \`activity_logs_user_id_idx\` (\`user_id\`),
    INDEX \`activity_logs_created_at_idx\` (\`created_at\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`freelance_projects\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`client_name\` VARCHAR(200) NOT NULL,
    \`work_type\` VARCHAR(200) NOT NULL,
    \`charge_type\` VARCHAR(100) NOT NULL,
    \`rate\` DECIMAL(15,2) NOT NULL,
    \`status\` ENUM('ACTIVE','COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    \`notes\` TEXT,
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`freelance_projects_user_id_idx\` (\`user_id\`),
    INDEX \`freelance_projects_status_idx\` (\`status\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`proposals\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`proposal_number\` VARCHAR(100) NOT NULL,
    \`service_type\` VARCHAR(200) NOT NULL DEFAULT 'Services',
    \`date\` VARCHAR(10) NOT NULL,
    \`valid_till\` VARCHAR(10) NOT NULL,
    \`client_name\` VARCHAR(200) NOT NULL,
    \`client_phone\` VARCHAR(50),
    \`client_email\` VARCHAR(255),
    \`client_address\` TEXT,
    \`site_name\` VARCHAR(200),
    \`project_location\` VARCHAR(200),
    \`project_type\` VARCHAR(100),
    \`project_scope\` VARCHAR(500),
    \`about_company\` TEXT,
    \`scope_of_work\` JSON,
    \`fees_description\` VARCHAR(500) NOT NULL,
    \`fees_amount\` DECIMAL(15,2) NOT NULL,
    \`fees_amount_in_words\` VARCHAR(500),
    \`fees_note\` TEXT,
    \`payment_milestones\` JSON,
    \`terms_and_conditions\` JSON,
    \`status\` ENUM('DRAFT','SENT','ACCEPTED','REJECTED') NOT NULL DEFAULT 'DRAFT',
    \`share_token\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`proposals_share_token_idx\` (\`share_token\`),
    INDEX \`proposals_user_id_idx\` (\`user_id\`),
    INDEX \`proposals_status_idx\` (\`status\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`freelance_work_logs\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`freelance_project_id\` VARCHAR(128) NOT NULL,
    \`description\` TEXT,
    \`quantity\` DECIMAL(10,2) NOT NULL,
    \`amount\` DECIMAL(15,2) NOT NULL,
    \`date\` TIMESTAMP NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`freelance_work_logs_project_id_idx\` (\`freelance_project_id\`),
    INDEX \`freelance_work_logs_date_idx\` (\`date\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`invoices\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`invoice_number\` VARCHAR(100) NOT NULL,
    \`invoice_date\` VARCHAR(10) NOT NULL,
    \`due_date\` VARCHAR(10) NOT NULL,
    \`client_id\` VARCHAR(128),
    \`client_name\` VARCHAR(200) NOT NULL,
    \`client_phone\` VARCHAR(50),
    \`client_email\` VARCHAR(255),
    \`client_address\` TEXT,
    \`client_gstin\` VARCHAR(20),
    \`supplier_state_code\` VARCHAR(2),
    \`supplier_state_name\` VARCHAR(100),
    \`place_of_supply_code\` VARCHAR(2),
    \`place_of_supply_name\` VARCHAR(100),
    \`is_inter_state\` TINYINT(1) NOT NULL DEFAULT 0,
    \`line_items\` JSON,
    \`subtotal\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`discount_total\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`taxable_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`cgst_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`sgst_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`igst_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`total_tax\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`round_off\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`total_amount\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`amount_in_words\` VARCHAR(500),
    \`amount_paid\` DECIMAL(15,2) NOT NULL DEFAULT 0,
    \`notes\` TEXT,
    \`terms_and_conditions\` JSON,
    \`bank_name\` VARCHAR(200),
    \`bank_account_name\` VARCHAR(200),
    \`bank_account_number\` VARCHAR(50),
    \`bank_ifsc\` VARCHAR(20),
    \`upi_id\` VARCHAR(100),
    \`status\` ENUM('DRAFT','SENT','PART_PAID','PAID','OVERDUE','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    \`share_token\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`invoices_share_token_idx\` (\`share_token\`),
    INDEX \`invoices_user_id_idx\` (\`user_id\`),
    INDEX \`invoices_status_idx\` (\`status\`),
    INDEX \`invoices_client_id_idx\` (\`client_id\`),
    INDEX \`invoices_number_idx\` (\`invoice_number\`)
  )`,
  // -----------------------------------------------------------------
  // Studio AI — WhatsApp project knowledge engine
  // -----------------------------------------------------------------

  `CREATE TABLE IF NOT EXISTS \`studio_projects\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(200) NOT NULL,
    \`client_name\` VARCHAR(200),
    \`site_address\` TEXT,
    \`project_type\` VARCHAR(100),
    \`budget\` DECIMAL(15,2),
    \`timeline_notes\` TEXT,
    \`status\` ENUM('ACTIVE','ON_HOLD','COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    \`client_id\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_projects_user_id_idx\` (\`user_id\`),
    INDEX \`studio_projects_status_idx\` (\`status\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_whatsapp_groups\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`external_group_id\` VARCHAR(255),
    \`name\` VARCHAR(255) NOT NULL,
    \`group_type\` VARCHAR(50),
    \`project_id\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`studio_whatsapp_groups_external_id_idx\` (\`external_group_id\`),
    INDEX \`studio_whatsapp_groups_user_id_idx\` (\`user_id\`),
    INDEX \`studio_whatsapp_groups_project_id_idx\` (\`project_id\`),
    INDEX \`studio_whatsapp_groups_name_user_idx\` (\`name\`, \`user_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_messages\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`source\` VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
    \`group_id\` VARCHAR(128),
    \`group_name\` VARCHAR(255),
    \`project_id\` VARCHAR(128),
    \`project_confidence\` DECIMAL(4,3),
    \`sender\` VARCHAR(255),
    \`sender_id\` VARCHAR(255),
    \`message_type\` VARCHAR(20) NOT NULL DEFAULT 'text',
    \`content\` TEXT,
    \`reply_to_message_id\` VARCHAR(128),
    \`external_message_id\` VARCHAR(255),
    \`embedding\` JSON,
    \`timestamp\` TIMESTAMP NOT NULL,
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`studio_messages_external_id_idx\` (\`external_message_id\`),
    INDEX \`studio_messages_user_id_idx\` (\`user_id\`),
    INDEX \`studio_messages_project_id_idx\` (\`project_id\`),
    INDEX \`studio_messages_group_id_idx\` (\`group_id\`),
    INDEX \`studio_messages_timestamp_idx\` (\`timestamp\`),
    FULLTEXT INDEX \`studio_messages_content_fts\` (\`content\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_message_media\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`message_id\` VARCHAR(128) NOT NULL,
    \`file_name\` VARCHAR(500),
    \`mime_type\` VARCHAR(255),
    \`storage_url\` TEXT NOT NULL,
    \`media_kind\` VARCHAR(20),
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_message_media_message_id_idx\` (\`message_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_documents\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`project_id\` VARCHAR(128),
    \`project_confidence\` DECIMAL(4,3),
    \`source_message_id\` VARCHAR(128),
    \`file_name\` VARCHAR(500) NOT NULL,
    \`mime_type\` VARCHAR(255),
    \`storage_url\` TEXT NOT NULL,
    \`extracted_text\` TEXT,
    \`document_type\` VARCHAR(50),
    \`ocr_used\` TINYINT(1) NOT NULL DEFAULT 0,
    \`uploaded_by\` VARCHAR(255),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_documents_user_id_idx\` (\`user_id\`),
    INDEX \`studio_documents_project_id_idx\` (\`project_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_document_chunks\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`document_id\` VARCHAR(128) NOT NULL,
    \`chunk_index\` INT NOT NULL,
    \`content\` TEXT NOT NULL,
    \`embedding\` JSON,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_document_chunks_document_id_idx\` (\`document_id\`),
    FULLTEXT INDEX \`studio_document_chunks_content_fts\` (\`content\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_decisions\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`project_id\` VARCHAR(128),
    \`topic\` VARCHAR(500) NOT NULL,
    \`decision\` TEXT NOT NULL,
    \`decision_by\` VARCHAR(255),
    \`decision_date\` TIMESTAMP NULL,
    \`source_message_id\` VARCHAR(128),
    \`source_document_id\` VARCHAR(128),
    \`confidence\` DECIMAL(4,3),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_decisions_user_id_idx\` (\`user_id\`),
    INDEX \`studio_decisions_project_id_idx\` (\`project_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_tasks\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`project_id\` VARCHAR(128),
    \`title\` VARCHAR(500) NOT NULL,
    \`description\` TEXT,
    \`assigned_to\` VARCHAR(255),
    \`priority\` ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
    \`status\` ENUM('open','in_progress','done','cancelled') NOT NULL DEFAULT 'open',
    \`due_date\` TIMESTAMP NULL,
    \`source_message_id\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_tasks_user_id_idx\` (\`user_id\`),
    INDEX \`studio_tasks_project_id_idx\` (\`project_id\`),
    INDEX \`studio_tasks_status_idx\` (\`status\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_deadlines\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`project_id\` VARCHAR(128),
    \`description\` TEXT NOT NULL,
    \`due_date\` TIMESTAMP NULL,
    \`source_message_id\` VARCHAR(128),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_deadlines_user_id_idx\` (\`user_id\`),
    INDEX \`studio_deadlines_project_id_idx\` (\`project_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_vendors\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`contact_info\` TEXT,
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`studio_vendors_name_user_idx\` (\`name\`, \`user_id\`),
    INDEX \`studio_vendors_user_id_idx\` (\`user_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_materials\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`category\` VARCHAR(100),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_materials_user_id_idx\` (\`user_id\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`studio_quotes\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`project_id\` VARCHAR(128),
    \`vendor_id\` VARCHAR(128),
    \`material_id\` VARCHAR(128),
    \`description\` TEXT,
    \`price\` DECIMAL(15,2),
    \`unit\` VARCHAR(50),
    \`status\` ENUM('quoted','revised','approved','rejected') NOT NULL DEFAULT 'quoted',
    \`quote_date\` TIMESTAMP NULL,
    \`source_message_id\` VARCHAR(128),
    \`source_document_id\` VARCHAR(128),
    \`confidence\` DECIMAL(4,3),
    \`user_id\` VARCHAR(128) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`studio_quotes_user_id_idx\` (\`user_id\`),
    INDEX \`studio_quotes_project_id_idx\` (\`project_id\`)
  )`,
]

// Columns to add to existing tables: [table, column, definition]
const ALTER_COLUMNS: [string, string, string][] = [
  ['users', 'company_name',     'VARCHAR(255)'],
  ['users', 'company_logo_url', 'TEXT'],
  ['users', 'company_phone',    'VARCHAR(50)'],
  ['users', 'company_address',  'TEXT'],
  ['users', 'company_website',  'VARCHAR(500)'],
  ['users', 'company_gstin',    'VARCHAR(20)'],
  ['users', 'studio_ingestion_key_hash', 'VARCHAR(255)'],
  ['payments', 'freelance_project_id', 'VARCHAR(128)'],
  ['files',    'freelance_project_id', 'VARCHAR(128)'],
  ['proposals', 'proposal_type', "ENUM('STANDARD','COST_BREAKUP') NOT NULL DEFAULT 'STANDARD'"],
  ['proposals', 'material_sections', 'JSON'],
  ['proposals', 'cost_breakup_items', 'JSON'],
  ['proposals', 'version', 'INT NOT NULL DEFAULT 1'],
  ['proposals', 'root_proposal_id', 'VARCHAR(128)'],
]

// Columns to make nullable if currently NOT NULL: [table, column, varchar-definition]
const MAKE_NULLABLE: [string, string, string][] = [
  ['payments', 'client_id', 'VARCHAR(128)'],
  ['files',    'client_id', 'VARCHAR(128)'],
]

export async function runMigrations() {
  console.log('[migrate] Connecting to database...')

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    ssl: { rejectUnauthorized: false },
  })

  console.log('[migrate] Running migrations...')

  for (const sql of CREATE_STATEMENTS) {
    await connection.execute(sql)
  }

  // Add new columns only when they don't already exist
  for (const [table, column, definition] of ALTER_COLUMNS) {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    ) as [{ cnt: number }[], unknown]
    if (rows[0].cnt === 0) {
      await connection.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
      console.log(`[migrate] Added column ${table}.${column}`)
    }
  }

  // Make columns nullable if they are currently NOT NULL
  for (const [table, column, definition] of MAKE_NULLABLE) {
    const [rows] = await connection.execute(
      `SELECT IS_NULLABLE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    ) as [{ IS_NULLABLE: string }[], unknown]
    if (rows[0]?.IS_NULLABLE === 'NO') {
      await connection.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`)
      console.log(`[migrate] Made ${table}.${column} nullable`)
    }
  }

  console.log('[migrate] All tables created/verified successfully')
  await connection.end()
}
