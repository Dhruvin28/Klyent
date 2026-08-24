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
]

// Columns to add to existing tables: [table, column, definition]
const ALTER_COLUMNS: [string, string, string][] = [
  ['users', 'company_name',     'VARCHAR(255)'],
  ['users', 'company_logo_url', 'TEXT'],
  ['users', 'company_phone',    'VARCHAR(50)'],
  ['users', 'company_address',  'TEXT'],
  ['users', 'company_website',  'VARCHAR(500)'],
  ['users', 'company_gstin',    'VARCHAR(20)'],
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
