import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, or, asc, desc, like, isNull, isNotNull } from 'drizzle-orm'
import { db, studioVendors, studioQuotes, vendorProducts, vendorProductPrices } from '../../db'
import { validationError, numericFields, ownedVendor, findOrCreateVendor } from './shared'

const productSchema = z.object({
  vendorId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(255),
  brand: z.string().max(150).optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  unit: z.string().min(1).max(30).optional().default('Nos'),
  price: z.number().min(0),
  gstRate: z.number().min(0).max(100).optional().default(18),
  hsnCode: z.string().max(20).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  minOrderQty: z.number().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
})

const updateProductSchema = productSchema.partial().extend({
  // Defaults must not apply on update, or a PATCH would reset them.
  unit: z.string().min(1).max(30).optional(),
  gstRate: z.number().min(0).max(100).optional(),
})

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  vendorId: z.string().max(128).optional(),
  category: z.string().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
})

const importSchema = z.object({
  rows: z.array(z.object({
    vendorName: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
    brand: z.string().max(150).optional().nullable(),
    sku: z.string().max(100).optional().nullable(),
    category: z.string().max(100).optional().nullable(),
    unit: z.string().max(30).optional().nullable(),
    price: z.number().min(0),
    gstRate: z.number().min(0).max(100).optional().nullable(),
    hsnCode: z.string().max(20).optional().nullable(),
    leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  })).min(1).max(2000),
})

const NUMERIC = ['price', 'gstRate', 'minOrderQty'] as const
const serialize = <T extends Record<string, unknown>>(row: T) => numericFields(row, NUMERIC)

const productColumns = {
  id: vendorProducts.id,
  vendorId: vendorProducts.vendorId,
  vendorName: studioVendors.name,
  vendorPhone: studioVendors.phone,
  name: vendorProducts.name,
  brand: vendorProducts.brand,
  sku: vendorProducts.sku,
  category: vendorProducts.category,
  unit: vendorProducts.unit,
  price: vendorProducts.price,
  gstRate: vendorProducts.gstRate,
  hsnCode: vendorProducts.hsnCode,
  description: vendorProducts.description,
  leadTimeDays: vendorProducts.leadTimeDays,
  minOrderQty: vendorProducts.minOrderQty,
  isActive: vendorProducts.isActive,
  source: vendorProducts.source,
  priceUpdatedAt: vendorProducts.priceUpdatedAt,
  createdAt: vendorProducts.createdAt,
  updatedAt: vendorProducts.updatedAt,
}

async function getProduct(userId: string, id: string) {
  const [row] = await db.select(productColumns).from(vendorProducts)
    .innerJoin(studioVendors, eq(studioVendors.id, vendorProducts.vendorId))
    .where(and(eq(vendorProducts.id, id), eq(vendorProducts.userId, userId)))
    .limit(1)
  return row ? serialize(row) : null
}

async function recordPrice(userId: string, productId: string, price: number) {
  await db.insert(vendorProductPrices).values({
    id: crypto.randomUUID(), userId, productId, price: String(price),
  })
}

export default async function productRoutes(app: FastifyInstance) {
  // GET /api/procurement/products — the catalog, cheapest first within a name,
  // so the same product from different vendors lines up for comparison.
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const result = listQuerySchema.safeParse(request.query)
    if (!result.success) return validationError(reply, result.error)
    const { q, vendorId, category, includeInactive, limit } = result.data

    const conditions = [eq(vendorProducts.userId, userId)]
    if (includeInactive !== 'true') conditions.push(eq(vendorProducts.isActive, true))
    if (vendorId) conditions.push(eq(vendorProducts.vendorId, vendorId))
    if (category) conditions.push(eq(vendorProducts.category, category))
    if (q) {
      // Every word must match somewhere, so "18mm ply" finds "Plywood BWP 18mm".
      for (const word of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        conditions.push(or(
          like(vendorProducts.name, `%${word}%`),
          like(vendorProducts.brand, `%${word}%`),
          like(vendorProducts.sku, `%${word}%`),
          like(vendorProducts.category, `%${word}%`),
          like(studioVendors.name, `%${word}%`),
        )!)
      }
    }

    const rows = await db.select(productColumns).from(vendorProducts)
      .innerJoin(studioVendors, eq(studioVendors.id, vendorProducts.vendorId))
      .where(and(...conditions))
      .orderBy(asc(vendorProducts.name), asc(vendorProducts.price))
      .limit(limit)

    return reply.send({ data: rows.map(serialize) })
  })

  // GET /api/procurement/products/categories
  app.get('/categories', async (request, reply) => {
    const userId = request.user.sub
    const rows = await db.selectDistinct({ category: vendorProducts.category }).from(vendorProducts)
      .where(and(eq(vendorProducts.userId, userId), isNotNull(vendorProducts.category)))
      .orderBy(asc(vendorProducts.category))
    return reply.send({ data: rows.map((r) => r.category).filter(Boolean) })
  })

  // POST /api/procurement/products
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = productSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const { price, gstRate, minOrderQty, ...rest } = result.data
    if (!(await ownedVendor(userId, rest.vendorId))) return reply.code(404).send({ error: 'Vendor not found' })

    const id = crypto.randomUUID()
    await db.insert(vendorProducts).values({
      id,
      userId,
      ...rest,
      price: String(price),
      gstRate: String(gstRate),
      minOrderQty: minOrderQty != null ? String(minOrderQty) : null,
      source: 'designer',
    })
    await recordPrice(userId, id, price)

    return reply.code(201).send({ data: await getProduct(userId, id) })
  })

  // POST /api/procurement/products/import — rows from a vendor price list (CSV
  // parsed in the browser). Vendors are matched by name and created when new;
  // a product matches on SKU when given, otherwise on name + brand, and only its
  // price and details are updated.
  app.post('/import', async (request, reply) => {
    const userId = request.user.sub
    const result = importSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const vendorIds = new Map<string, string>()
    let created = 0
    let updated = 0
    let unchanged = 0
    let vendorsCreated = 0

    for (const row of result.data.rows) {
      const key = row.vendorName.trim().toLowerCase()
      let vendorId = vendorIds.get(key)
      if (!vendorId) {
        const v = await findOrCreateVendor(userId, row.vendorName)
        vendorId = v.id
        if (v.created) vendorsCreated++
        vendorIds.set(key, vendorId)
      }

      const match = row.sku
        ? and(eq(vendorProducts.vendorId, vendorId), eq(vendorProducts.sku, row.sku))
        : and(
            eq(vendorProducts.vendorId, vendorId),
            eq(vendorProducts.name, row.name),
            row.brand ? eq(vendorProducts.brand, row.brand) : isNull(vendorProducts.brand),
          )
      const [existing] = await db.select({ id: vendorProducts.id, price: vendorProducts.price })
        .from(vendorProducts)
        .where(and(eq(vendorProducts.userId, userId), match))
        .limit(1)

      const details = {
        name: row.name,
        brand: row.brand || null,
        sku: row.sku || null,
        category: row.category || null,
        unit: row.unit || 'Nos',
        gstRate: String(row.gstRate ?? 18),
        hsnCode: row.hsnCode || null,
        leadTimeDays: row.leadTimeDays ?? null,
      }

      if (existing) {
        // A rates-only sheet must not wipe details the product already has, so
        // only fields present in the file are overwritten.
        const provided = Object.fromEntries(
          Object.entries(details).filter(([k, v]) => v !== null && (k !== 'unit' || !!row.unit) && (k !== 'gstRate' || row.gstRate != null))
        )
        const priceChanged = Number(existing.price) !== row.price
        await db.update(vendorProducts).set({
          ...provided,
          isActive: true,
          ...(priceChanged ? { price: String(row.price), priceUpdatedAt: new Date() } : {}),
        }).where(eq(vendorProducts.id, existing.id))
        if (priceChanged) {
          await recordPrice(userId, existing.id, row.price)
          updated++
        } else {
          unchanged++
        }
      } else {
        const id = crypto.randomUUID()
        await db.insert(vendorProducts).values({
          id, userId, vendorId, ...details, price: String(row.price), source: 'import',
        })
        await recordPrice(userId, id, row.price)
        created++
      }
    }

    return reply.send({ data: { created, updated, unchanged, vendorsCreated } })
  })

  // GET /api/procurement/products/:id/prices — price history, newest first
  app.get('/:id/prices', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const rows = await db.select({ price: vendorProductPrices.price, recordedAt: vendorProductPrices.recordedAt })
      .from(vendorProductPrices)
      .where(and(eq(vendorProductPrices.productId, id), eq(vendorProductPrices.userId, userId)))
      .orderBy(desc(vendorProductPrices.recordedAt))
      .limit(50)
    return reply.send({ data: rows.map((r) => ({ ...r, price: Number(r.price) })) })
  })

  // PATCH /api/procurement/products/:id
  app.patch('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const result = updateProductSchema.safeParse(request.body)
    if (!result.success) return validationError(reply, result.error)

    const [existing] = await db.select({ price: vendorProducts.price }).from(vendorProducts)
      .where(and(eq(vendorProducts.id, id), eq(vendorProducts.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Product not found' })

    const { price, gstRate, minOrderQty, vendorId, ...rest } = result.data
    if (vendorId && !(await ownedVendor(userId, vendorId))) return reply.code(404).send({ error: 'Vendor not found' })

    const priceChanged = price !== undefined && Number(existing.price) !== price
    await db.update(vendorProducts).set({
      ...rest,
      ...(vendorId ? { vendorId } : {}),
      ...(gstRate !== undefined ? { gstRate: String(gstRate) } : {}),
      ...(minOrderQty !== undefined ? { minOrderQty: minOrderQty != null ? String(minOrderQty) : null } : {}),
      ...(priceChanged ? { price: String(price), priceUpdatedAt: new Date() } : {}),
    }).where(eq(vendorProducts.id, id))
    if (priceChanged) await recordPrice(userId, id, price!)

    return reply.send({ data: await getProduct(userId, id) })
  })

  // DELETE /api/procurement/products/:id — quotes taken from it keep their figures
  app.delete('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [existing] = await db.select({ id: vendorProducts.id }).from(vendorProducts)
      .where(and(eq(vendorProducts.id, id), eq(vendorProducts.userId, userId)))
      .limit(1)
    if (!existing) return reply.code(404).send({ error: 'Product not found' })

    await db.update(studioQuotes).set({ productId: null })
      .where(and(eq(studioQuotes.userId, userId), eq(studioQuotes.productId, id)))
    await db.delete(vendorProductPrices).where(eq(vendorProductPrices.productId, id))
    await db.delete(vendorProducts).where(eq(vendorProducts.id, id))
    return reply.code(204).send()
  })
}
