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
    \`client_id\` VARCHAR(128) NOT NULL,
    \`user_id\` VARCHAR(128) NOT NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`payments_client_id_idx\` (\`client_id\`),
    INDEX \`payments_user_id_idx\` (\`user_id\`),
    INDEX \`payments_date_idx\` (\`date\`)
  )`,

  `CREATE TABLE IF NOT EXISTS \`files\` (
    \`id\` VARCHAR(128) NOT NULL,
    \`name\` VARCHAR(500) NOT NULL,
    \`description\` TEXT,
    \`mime_type\` VARCHAR(255) NOT NULL,
    \`client_id\` VARCHAR(128) NOT NULL,
    \`share_token\` VARCHAR(128),
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`files_share_token_idx\` (\`share_token\`),
    INDEX \`files_client_id_idx\` (\`client_id\`)
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
]

// Columns to add to existing tables: [table, column, definition]
const ALTER_COLUMNS: [string, string, string][] = [
  ['users', 'company_name',     'VARCHAR(255)'],
  ['users', 'company_logo_url', 'TEXT'],
  ['users', 'company_phone',    'VARCHAR(50)'],
  ['users', 'company_address',  'TEXT'],
  ['users', 'company_website',  'VARCHAR(500)'],
  ['users', 'company_gstin',    'VARCHAR(20)'],
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

  // Add new columns only when they don't already exist (compatible with all MySQL versions)
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

  console.log('[migrate] All tables created/verified successfully')
  await connection.end()
}
