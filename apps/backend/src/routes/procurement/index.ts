import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import vendorRoutes from './vendors'
import productRoutes from './products'
import itemRoutes from './items'
import orderRoutes from './orders'
import summaryRoutes from './summary'

// Procurement: vendors and their price lists, requirements with competing
// quotes, purchase orders with delivery and payment tracking.
export default async function procurementRoutes(app: FastifyInstance) {
  // Orders carry their own public share routes, so they authenticate themselves.
  await app.register(orderRoutes, { prefix: '/orders' })

  await app.register(async (priv: FastifyInstance) => {
    priv.addHook('preHandler', authenticate)
    await priv.register(vendorRoutes, { prefix: '/vendors' })
    await priv.register(productRoutes, { prefix: '/products' })
    await priv.register(itemRoutes, { prefix: '/items' })
    await priv.register(summaryRoutes, { prefix: '/summary' })
  })
}
