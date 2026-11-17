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
  // AI chat tab — only the API key comes from env; models/effort are chosen per request in the UI.
  ai: {
    maxFiles: 6,
    maxFileSize: 10 * 1024 * 1024, // 10MB per attachment (stored in the DB)
  },
  // Studio AI (WhatsApp knowledge engine) — Option A groundwork, off until configured.
  studioWhatsapp: {
    verifyToken: process.env.STUDIO_WHATSAPP_VERIFY_TOKEN ?? '',
    accessToken: process.env.STUDIO_WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.STUDIO_WHATSAPP_PHONE_NUMBER_ID ?? '',
    appSecret: process.env.STUDIO_WHATSAPP_APP_SECRET ?? '',
  },
  // Material Replacement Visualizer — binary assets are stored in MySQL (LONGBLOB), so
  // the DB's max_allowed_packet must exceed maxAssetSize (MySQL 8 default is 64MB).
  visualizer: {
    maxAssetSize: 40 * 1024 * 1024,
    maxSide: 8192,
    maxPixels: 25_000_000,
    maxTextureSide: 4096,
  },
  designer: {
    // Walkthrough videos and GLB models are larger than render images.
    maxAssetSize: 80 * 1024 * 1024,
    maxPlanBytes: 3 * 1024 * 1024,
    // Total download cap when packing a Poly Haven model.
    maxImportBytes: 60 * 1024 * 1024,
  },
  // Interior 3D — dimension-preserving drawing → 3D reconstruction.
  interior: {
    enabled: (process.env.INTERIOR_ENABLED ?? 'true') !== 'false',
    // Strongest available reasoning + vision model; interpretation is evidence-bound and
    // every geometric result is re-checked deterministically, so the model never decides
    // authoritative dimensions on its own.
    model: process.env.INTERIOR_OPENAI_INTERPRETATION_MODEL ?? 'gpt-6-astra',
    reasoningEffort: process.env.INTERIOR_OPENAI_REASONING_EFFORT ?? 'high',
    maxOutputTokens: parseInt(process.env.INTERIOR_OPENAI_MAX_OUTPUT_TOKENS ?? '64000'),
    requestTimeoutMs: parseInt(process.env.INTERIOR_OPENAI_TIMEOUT_MS ?? String(20 * 60 * 1000)),
    // Per-job token budget (input + output). A job over budget stops for review.
    maxTokensPerJob: parseInt(process.env.INTERIOR_MAX_TOKENS_PER_JOB ?? '400000'),
    maxUploadBytes: parseInt(process.env.INTERIOR_MAX_UPLOAD_BYTES ?? String(60 * 1024 * 1024)),
    maxRasterBytes: 30 * 1024 * 1024,
    maxPdfPages: 40,
    maxPagesPerWorkspace: 120,
    maxDecodedPixels: 100_000_000,
    // Stored page raster (long side) and the image sent to the model.
    pageLongSide: 3200,
    previewLongSide: 2048,
    maxVectorSegments: 250_000,
    maxTextTokensToModel: 1800,
    workerConcurrency: parseInt(process.env.INTERIOR_WORKER_CONCURRENCY ?? '2'),
    leaseSeconds: parseInt(process.env.INTERIOR_WORKER_LEASE_SECONDS ?? '300'),
    sceneSchemaVersion: 'interior-scene/1',
    // Server-side rendering: Blender (Cycles) for the physically based image, then an
    // OpenAI image model to push it to photographic realism under a strict fidelity check.
    render: {
      blenderPath: process.env.BLENDER_PATH ?? '',
      blenderDevice: process.env.BLENDER_DEVICE ?? 'cpu',
      blenderThreads: parseInt(process.env.BLENDER_THREADS ?? '0'),
      timeoutMs: parseInt(process.env.INTERIOR_RENDER_TIMEOUT_MS ?? String(45 * 60 * 1000)),
      enhance: (process.env.INTERIOR_RENDER_ENHANCE ?? 'true') !== 'false',
      imageModel: process.env.INTERIOR_RENDER_IMAGE_MODEL ?? 'gpt-image-2',
      imageQuality: process.env.INTERIOR_RENDER_IMAGE_QUALITY ?? 'high',
      verifyModel: process.env.INTERIOR_RENDER_VERIFY_MODEL ?? '',
      enhanceTimeoutMs: parseInt(process.env.INTERIOR_RENDER_ENHANCE_TIMEOUT_MS ?? String(10 * 60 * 1000)),
    },
  },
  studioUpload: {
    maxSize: 50 * 1024 * 1024, // 50MB — documents/media
    maxImportSize: 200 * 1024 * 1024, // 200MB — WhatsApp export zips can be large with media
  },
}
