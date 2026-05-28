import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { db, users } from '../../db'
import { authenticate } from '../../middleware/authenticate'

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
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
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const { email, name, password } = result.data

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (existing) {
      return reply.code(409).send({ error: 'Email already in use' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const id = crypto.randomUUID()

    await db.insert(users).values({ id, email, name, password: hashedPassword })

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)

    const token = await reply.jwtSign({
      sub: user.id,
      email: user.email,
      role: user.role,
    })

    return reply.code(201).send({ token, user })
  })

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const { email, password } = result.data

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user) {
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return reply.code(401).send({ error: 'Invalid email or password' })
    }

    const token = await reply.jwtSign({
      sub: user.id,
      email: user.email,
      role: user.role,
    })

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    })
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      return reply.code(404).send({ error: 'User not found' })
    }

    return reply.send({ user })
  })

  // PATCH /api/auth/me - update name and email
  app.patch('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }

    const { name, email } = result.data

    // Check email not taken by another user
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, userId)))
      .limit(1)
    if (existing) {
      return reply.code(409).send({ error: 'Email already in use by another account' })
    }

    await db.update(users).set({ name, email }).where(eq(users.id, userId))

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return reply.send({ user })
  })

  // PATCH /api/auth/me/password - change password
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

    const hashed = await bcrypt.hash(newPassword, 12)
    await db.update(users).set({ password: hashed }).where(eq(users.id, userId))

    return reply.send({ message: 'Password updated successfully' })
  })
}
