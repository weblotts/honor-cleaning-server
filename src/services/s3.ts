import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return s3Client;
}

const BUCKET = () => process.env.S3_BUCKET_NAME || 'honor-cleaning-photos';

/**
 * Generate a presigned PUT URL for direct browser upload.
 */
export async function getUploadUrl(params: {
  folder: 'before' | 'after';
  jobId: string;
  contentType: string;
}): Promise<{ uploadUrl: string; key: string }> {
  const ext = params.contentType.split('/')[1] || 'jpg';
  const key = `jobs/${params.jobId}/${params.folder}/${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: params.contentType,
  });

  const uploadUrl = await getSignedUrl(getS3(), command, { expiresIn: 300 }); // 5 min
  return { uploadUrl, key };
}

/**
 * Generate a presigned GET URL for viewing a photo.
 */
export async function getViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  });
  return getSignedUrl(getS3(), command, { expiresIn: 3600 }); // 1 hour
}
