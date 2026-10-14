import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../core/config/config.js';

/** Object storage S3 compatível (MinIO em desenvolvimento). Objetos privados; acesso só por URL pré-assinada. */
@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new S3Client({
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ENDPOINT === undefined ? {} : { endpoint: config.S3_ENDPOINT }),
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }

  presignUpload(key: string, mimeType: string, sizeBytes: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
      {
        expiresIn: this.config.UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  presignDownload(key: string, fileName: string, mimeType: string): Promise<string> {
    const safeName = fileName.replace(/["\\\r\n]/g, '_');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        ResponseContentType: mimeType,
      }),
      { expiresIn: 300 },
    );
  }

  /** Tamanho do objeto enviado (null se não existir). */
  async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }
}
