import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const url = new URL(process.env.DATABASE_URL!)

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: url.hostname,
    port: parseInt(url.port || '3306'),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace('/', ''),
    ssl: {
      rejectUnauthorized: false,
    },
  },
})
