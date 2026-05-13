import { PrismaClient, Prisma, PaymentMethod, ClientStatus, ActivityType } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const paymentMethods: PaymentMethod[] = ['CASH', 'ONLINE', 'CHEQUE']

const clientData = [
  {
    name: 'Acme Corporation',
    email: 'billing@acme.com',
    phone: '+1-555-0101',
    address: '123 Main St, San Francisco, CA 94102',
    projectDescription: 'Complete digital transformation including website redesign, CRM implementation, and analytics dashboard.',
    totalDealAmount: 85000,
    status: 'COMPLETED' as ClientStatus,
  },
  {
    name: 'Brightside Media',
    email: 'accounts@brightside.com',
    phone: '+1-555-0202',
    address: '456 Oak Ave, New York, NY 10001',
    projectDescription: 'Brand identity refresh, social media strategy, and monthly content creation package.',
    totalDealAmount: 24000,
    status: 'ACTIVE' as ClientStatus,
  },
  {
    name: 'TechFlow Solutions',
    email: 'finance@techflow.io',
    phone: '+1-555-0303',
    address: '789 Innovation Blvd, Austin, TX 78701',
    projectDescription: 'Custom SaaS platform development with mobile app integration and third-party API connections.',
    totalDealAmount: 120000,
    status: 'ACTIVE' as ClientStatus,
  },
  {
    name: 'Green Earth Organics',
    email: 'info@greenearth.co',
    phone: '+1-555-0404',
    address: '321 Garden Ln, Portland, OR 97201',
    projectDescription: 'E-commerce platform, inventory management system, and SEO optimization campaign.',
    totalDealAmount: 38500,
    status: 'ON_HOLD' as ClientStatus,
  },
  {
    name: 'Pinnacle Realty Group',
    email: 'contact@pinnaclerealty.com',
    phone: '+1-555-0505',
    address: '999 Tower Dr, Chicago, IL 60601',
    projectDescription: 'Property listing portal, virtual tour integration, and lead management CRM.',
    totalDealAmount: 67000,
    status: 'ACTIVE' as ClientStatus,
  },
]

const fileData = [
  { name: 'Project_Proposal.pdf', mimeType: 'application/pdf' },
  { name: 'Contract_Agreement.pdf', mimeType: 'application/pdf' },
  { name: 'Brand_Guidelines.pdf', mimeType: 'application/pdf' },
  { name: 'Design_Mockup_v1.png', mimeType: 'image/png' },
  { name: 'Invoice_Q1.pdf', mimeType: 'application/pdf' },
  { name: 'Logo_Final.png', mimeType: 'image/png' },
  { name: 'Scope_of_Work.pdf', mimeType: 'application/pdf' },
  { name: 'Progress_Report.pdf', mimeType: 'application/pdf' },
]

async function main() {
  console.log('Starting seed...')

  // Clean existing data
  await prisma.activityLog.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.fileVersion.deleteMany()
  await prisma.file.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.client.deleteMany()
  await prisma.user.deleteMany()

  console.log('Cleaned existing data')

  // Create users
  const adminPassword = await bcrypt.hash('Admin123!', 12)
  const memberPassword = await bcrypt.hash('Member123!', 12)

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@klyent.com',
      name: 'Alex Admin',
      password: adminPassword,
      role: 'ADMIN',
    },
  })

  const memberUser = await prisma.user.create({
    data: {
      email: 'member@klyent.com',
      name: 'Morgan Member',
      password: memberPassword,
      role: 'MEMBER',
    },
  })

  console.log(`Created users: ${adminUser.email}, ${memberUser.email}`)

  const now = new Date()
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  // Create clients for admin user
  for (const clientInfo of clientData) {
    const client = await prisma.client.create({
      data: {
        ...clientInfo,
        totalDealAmount: new Prisma.Decimal(clientInfo.totalDealAmount),
        userId: adminUser.id,
        createdAt: randomDate(oneYearAgo, now),
      },
    })

    // Log CLIENT_CREATED activity
    await prisma.activityLog.create({
      data: {
        type: 'CLIENT_CREATED' as ActivityType,
        metadata: { clientName: client.name },
        clientId: client.id,
        userId: adminUser.id,
        createdAt: client.createdAt,
      },
    })

    console.log(`Created client: ${client.name}`)

    // Create payments (3-6 per client)
    const numPayments = Math.floor(Math.random() * 4) + 3
    const totalDeal = clientInfo.totalDealAmount
    const avgPayment = totalDeal / numPayments

    for (let i = 0; i < numPayments; i++) {
      const paymentAmount = Math.round(
        (avgPayment * (0.7 + Math.random() * 0.6)) * 100
      ) / 100

      const paymentDate = randomDate(client.createdAt, now)
      const method = randomElement(paymentMethods)

      const payment = await prisma.payment.create({
        data: {
          amount: new Prisma.Decimal(paymentAmount),
          method,
          date: paymentDate,
          notes:
            i === 0
              ? 'Initial deposit payment'
              : i === numPayments - 1
              ? 'Final payment upon project completion'
              : `Milestone ${i} payment`,
          clientId: client.id,
          userId: adminUser.id,
        },
      })

      await prisma.activityLog.create({
        data: {
          type: 'PAYMENT_ADDED' as ActivityType,
          metadata: {
            paymentId: payment.id,
            amount: paymentAmount,
            method,
            clientName: client.name,
          },
          clientId: client.id,
          userId: adminUser.id,
          createdAt: paymentDate,
        },
      })
    }

    // Create files (2-3 per client, with metadata only)
    const numFiles = Math.floor(Math.random() * 2) + 2
    const shuffledFiles = [...fileData].sort(() => Math.random() - 0.5).slice(0, numFiles)

    for (const fileInfo of shuffledFiles) {
      const fileCreatedAt = randomDate(client.createdAt, now)

      const file = await prisma.file.create({
        data: {
          name: fileInfo.name,
          mimeType: fileInfo.mimeType,
          clientId: client.id,
          createdAt: fileCreatedAt,
          updatedAt: fileCreatedAt,
        },
      })

      // Create version 1
      const v1 = await prisma.fileVersion.create({
        data: {
          versionNumber: 1,
          s3Key: `users/${adminUser.id}/clients/${client.id}/${file.id}/v1/${fileInfo.name}`,
          s3Bucket: 'klyent-files',
          size: Math.floor(Math.random() * 2000000) + 50000, // 50KB - 2MB
          isActive: true,
          uploadedById: adminUser.id,
          fileId: file.id,
          createdAt: fileCreatedAt,
        },
      })

      await prisma.activityLog.create({
        data: {
          type: 'FILE_UPLOADED' as ActivityType,
          metadata: {
            fileId: file.id,
            fileName: fileInfo.name,
            versionNumber: 1,
            size: v1.size,
            clientName: client.name,
          },
          clientId: client.id,
          userId: adminUser.id,
          createdAt: fileCreatedAt,
        },
      })

      // 40% chance of having a v2
      if (Math.random() > 0.6) {
        const v2Date = randomDate(fileCreatedAt, now)

        await prisma.fileVersion.update({
          where: { id: v1.id },
          data: { isActive: false },
        })

        const v2 = await prisma.fileVersion.create({
          data: {
            versionNumber: 2,
            s3Key: `users/${adminUser.id}/clients/${client.id}/${file.id}/v2/${fileInfo.name}`,
            s3Bucket: 'klyent-files',
            size: Math.floor(Math.random() * 2000000) + 50000,
            isActive: true,
            uploadedById: adminUser.id,
            fileId: file.id,
            createdAt: v2Date,
          },
        })

        await prisma.file.update({
          where: { id: file.id },
          data: { updatedAt: v2Date },
        })

        await prisma.activityLog.create({
          data: {
            type: 'FILE_VERSION_ADDED' as ActivityType,
            metadata: {
              fileId: file.id,
              fileName: fileInfo.name,
              versionNumber: 2,
              size: v2.size,
              clientName: client.name,
            },
            clientId: client.id,
            userId: adminUser.id,
            createdAt: v2Date,
          },
        })

        // Add a comment on some files
        if (Math.random() > 0.5) {
          const comments = [
            'Please review the updated version and let me know if any changes are needed.',
            'Version 2 incorporates the feedback from our last meeting.',
            'Updated branding colors as requested.',
            'Fixed the typo on page 3 and updated the contact information.',
          ]

          await prisma.comment.create({
            data: {
              content: randomElement(comments),
              fileId: file.id,
              userId: adminUser.id,
              createdAt: v2Date,
            },
          })
        }
      }
    }

    // Log STATUS_CHANGED for completed/on-hold clients
    if (client.status !== 'ACTIVE') {
      const statusChangeDate = randomDate(client.createdAt, now)
      await prisma.activityLog.create({
        data: {
          type: 'STATUS_CHANGED' as ActivityType,
          metadata: {
            from: 'ACTIVE',
            to: client.status,
          },
          clientId: client.id,
          userId: adminUser.id,
          createdAt: statusChangeDate,
        },
      })
    }
  }

  // Create 2 clients for the member user
  const memberClients = [
    {
      name: 'Starlight Boutique',
      email: 'owner@starlightboutique.com',
      phone: '+1-555-0606',
      address: '12 Fashion Row, Miami, FL 33101',
      projectDescription: 'Online store setup, product photography guidelines, and email marketing automation.',
      totalDealAmount: 15000,
      status: 'ACTIVE' as ClientStatus,
    },
    {
      name: 'Metro Fitness Club',
      email: 'manager@metrofitness.com',
      phone: '+1-555-0707',
      address: '88 Athletic Way, Denver, CO 80201',
      projectDescription: 'Membership management app, class scheduling system, and payment gateway integration.',
      totalDealAmount: 32000,
      status: 'ACTIVE' as ClientStatus,
    },
  ]

  for (const clientInfo of memberClients) {
    const client = await prisma.client.create({
      data: {
        ...clientInfo,
        totalDealAmount: new Prisma.Decimal(clientInfo.totalDealAmount),
        userId: memberUser.id,
        createdAt: randomDate(oneYearAgo, now),
      },
    })

    await prisma.activityLog.create({
      data: {
        type: 'CLIENT_CREATED' as ActivityType,
        metadata: { clientName: client.name },
        clientId: client.id,
        userId: memberUser.id,
        createdAt: client.createdAt,
      },
    })

    // 2 payments per member client
    for (let i = 0; i < 2; i++) {
      const paymentAmount = clientInfo.totalDealAmount * 0.3
      const paymentDate = randomDate(client.createdAt, now)

      const payment = await prisma.payment.create({
        data: {
          amount: new Prisma.Decimal(paymentAmount),
          method: randomElement(paymentMethods),
          date: paymentDate,
          notes: i === 0 ? 'Initial deposit' : 'Second installment',
          clientId: client.id,
          userId: memberUser.id,
        },
      })

      await prisma.activityLog.create({
        data: {
          type: 'PAYMENT_ADDED' as ActivityType,
          metadata: {
            paymentId: payment.id,
            amount: paymentAmount,
            clientName: client.name,
          },
          clientId: client.id,
          userId: memberUser.id,
          createdAt: paymentDate,
        },
      })
    }

    console.log(`Created member client: ${client.name}`)
  }

  console.log('\nSeed completed successfully!')
  console.log('\nLogin credentials:')
  console.log('  Admin: admin@klyent.com / Admin123!')
  console.log('  Member: member@klyent.com / Member123!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
