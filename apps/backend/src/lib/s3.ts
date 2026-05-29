import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { config } from '../config'

export const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
})


export async function deleteS3Object(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }))
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  await s3Client.send(new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
  return `${config.r2.publicUrl}/${key}`
}
