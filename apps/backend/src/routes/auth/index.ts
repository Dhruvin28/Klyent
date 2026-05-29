import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { db, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { uploadToS3, deleteS3Object } from '../../lib/s3'

const USER_SELECT = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  companyName: users.companyName,
  companyLogoUrl: users.companyLogoUrl,
  companyPhone: users.companyPhone,
  companyAddress: users.companyAddress,
  companyWebsite: users.companyWebsite,
  companyGstin: users.companyGstin,
  createdAt: users.createdAt,
}

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  companyName: z.string().max(255).optional().nullable(),
  companyPhone: z.string().max(50).optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  companyWebsite: z.string().max(500).optional().nullable(),
  companyGstin: z.string().max(20).optional().nullable(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
})

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { email, name, password } = result.data

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (existing) return reply.code(409).send({ error: 'Email already in use' })

    const hashedPassword = await bcrypt.hash(password, 12)
    const id = crypto.randomUUID()
    await db.insert(users).values({ id, email, name, password: hashedPassword })

    const [user] = await db.select(USER_SELECT).from(users).where(eq(users.id, id)).limit(1)
    const token = await reply.jwtSign({ sub: user.id, email: user.email, role: user.role })
    return reply.code(201).send({ token, user })
  })

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { email, password } = result.data
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!row) return reply.code(401).send({ error: 'Invalid email or password' })

    const validPassword = await bcrypt.compare(password, row.password)
    if (!validPassword) return reply.code(401).send({ error: 'Invalid email or password' })

    const token = await reply.jwtSign({ sub: row.id, email: row.email, role: row.role })
    const [user] = await db.select(USER_SELECT).from(users).where(eq(users.id, row.id)).limit(1)
    return reply.send({ token, user })
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const [user] = await db.select({ ...USER_SELECT, updatedAt: users.updatedAt }).from(users).where(eq(users.id, userId)).limit(1)
    if (!user) return reply.code(404).send({ error: 'User not found' })
    return reply.send({ user })
  })

  // PATCH /api/auth/me
  app.patch('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { name, email, companyName, companyPhone, companyAddress, companyWebsite, companyGstin } = result.data

    const [dup] = await db.select().from(users).where(and(eq(users.email, email), ne(users.id, userId))).limit(1)
    if (dup) return reply.code(409).send({ error: 'Email already in use by another account' })

    await db.update(users).set({
      name, email,
      companyName: companyName ?? null,
      companyPhone: companyPhone ?? null,
      companyAddress: companyAddress ?? null,
      companyWebsite: companyWebsite ?? null,
      companyGstin: companyGstin ?? null,
    }).where(eq(users.id, userId))

    const [user] = await db.select(USER_SELECT).from(users).where(eq(users.id, userId)).limit(1)
    return reply.send({ user })
  })

  // POST /api/auth/me/logo — upload logo to R2, store public URL in DB
  app.post('/me/logo', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub

    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Only JPEG, PNG, WebP and SVG images are allowed' })
    }

    // Delete old logo from R2 if one exists
    const [current] = await db.select({ companyLogoUrl: users.companyLogoUrl }).from(users).where(eq(users.id, userId)).limit(1)
    if (current?.companyLogoUrl) {
      // Extract the S3 key from the stored public URL: remove the base public URL prefix
      const r2Base = process.env.R2_PUBLIC_URL ?? ''
      const oldKey = current.companyLogoUrl.startsWith(r2Base)
        ? current.companyLogoUrl.slice(r2Base.length).replace(/^\//, '')
        : null
      if (oldKey) await deleteS3Object(oldKey).catch(() => undefined)
    }

    const ext = data.mimetype === 'image/svg+xml' ? 'svg' : data.mimetype.split('/')[1]
    const key = `logos/${userId}-${Date.now()}.${ext}`
    const buffer = await data.toBuffer()

    // uploadToS3 uploads to R2 and returns the full public URL
    const publicUrl = await uploadToS3(key, buffer, data.mimetype)

    // Store the public URL directly in DB
    await db.update(users).set({ companyLogoUrl: publicUrl }).where(eq(users.id, userId))

    const [user] = await db.select(USER_SELECT).from(users).where(eq(users.id, userId)).limit(1)
    return reply.send({ user })
  })

  // PATCH /api/auth/me/password
  app.patch('/me/password', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const result = changePasswordSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { currentPassword, newPassword } = result.data
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) return reply.code(404).send({ error: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) return reply.code(400).send({ error: 'Current password is incorrect' })

    await db.update(users).set({ password: await bcrypt.hash(newPassword, 12) }).where(eq(users.id, userId))
    return reply.send({ message: 'Password updated successfully' })
  })
}
