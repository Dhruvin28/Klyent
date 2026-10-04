export const config = {
  port: parseInt(process.env.PORT ?? '3001'),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'super-secret-key-change-in-production',
  jwtExpiry: process.env.JWT_EXPIRY ?? '7d',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET_NAME ?? '',
    publicUrl: process.env.R2_PUBLIC_URL ?? '',
  },
  smtp: {
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  uploadMaxSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4.1-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  // Studio AI (WhatsApp knowledge engine) — Option A groundwork, off until configured.
  studioWhatsapp: {
    verifyToken: process.env.STUDIO_WHATSAPP_VERIFY_TOKEN ?? '',
    accessToken: process.env.STUDIO_WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.STUDIO_WHATSAPP_PHONE_NUMBER_ID ?? '',
    appSecret: process.env.STUDIO_WHATSAPP_APP_SECRET ?? '',
  },
  studioUpload: {
    maxSize: 50 * 1024 * 1024, // 50MB — documents/media
    maxImportSize: 200 * 1024 * 1024, // 200MB — WhatsApp export zips can be large with media
  },
}
