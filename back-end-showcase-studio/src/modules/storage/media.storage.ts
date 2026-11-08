import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import type { StorageProvider } from '@prisma/client';

export type UploadableMedia = {
  arrayBuffer(): Promise<ArrayBuffer>;
  type: string;
  size: number;
};

export type StoredMedia = {
  url: string;
  key: string;
  provider: StorageProvider;
};

export type MediaKind = 'THUMBNAIL' | 'PRESENTATION_PDF' | 'CONTRIBUTOR_AVATAR' | 'CANVA';

/** Erro operacional de armazenamento sem expor credenciais ou detalhes do SDK ao cliente. */
export class MediaStorageError extends Error {
  constructor(
    public readonly code: 'R2_NOT_CONFIGURED' | 'R2_UPLOAD_FAILED' | 'R2_DELETE_FAILED' | 'UNSUPPORTED_STORAGE_PROVIDER',
    message: string,
    public readonly publicMessage: string,
  ) {
    super(message);
    this.name = 'MediaStorageError';
  }
}

export function resolveStorageProvider(kind: MediaKind): StorageProvider {
  if (kind !== 'CANVA') return 'CLOUDFLARE_R2' as StorageProvider;
  return 'CANVA' as StorageProvider;
}

export type R2StorageConfig = {
  bucket: string;
  publicUrl: string;
  client: S3Client;
};

/**
 * Centraliza as credenciais do R2 para que os uploads diretos usem exatamente
 * o mesmo bucket e a mesma URL pública usados pela API.
 */
export function getR2StorageConfig(): R2StorageConfig {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME || !env.R2_PUBLIC_URL) {
    throw new MediaStorageError(
      'R2_NOT_CONFIGURED',
      'Cloudflare R2 environment variables are not configured.',
      'O armazenamento de imagens não está configurado. Verifique as variáveis do Cloudflare R2 na Vercel.',
    );
  }
  return {
    bucket: env.R2_BUCKET_NAME,
    publicUrl: env.R2_PUBLIC_URL.replace(/\/$/, ''),
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      // O SDK AWS recente calcula CRC32 automaticamente. Em um upload
      // pré-assinado, porém, ele não conhece o arquivo que será enviado pelo
      // navegador e acabava assinando o CRC de um corpo vazio. O R2 rejeita o
      // PUT real como assinatura incompatível. Só calculamos checksum quando
      // a operação o exigir explicitamente.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  };
}

export async function uploadMedia(key: string, file: UploadableMedia, provider: StorageProvider): Promise<StoredMedia> {
  const bytes = Buffer.from(await file.arrayBuffer());

  if (provider === 'CLOUDFLARE_R2') {
    const r2 = getR2StorageConfig();
    try {
      await r2.client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: bytes, ContentType: file.type }));
    } catch (error) {
      console.error('[MediaStorage] R2 upload failed', {
        key,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw new MediaStorageError(
        'R2_UPLOAD_FAILED',
        error instanceof Error ? error.message : String(error),
        'Não foi possível salvar a imagem no Cloudflare R2. Verifique as credenciais e tente novamente.',
      );
    }
    return { url: `${r2.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`, key, provider };
  }

  throw new MediaStorageError(
    'UNSUPPORTED_STORAGE_PROVIDER',
    `Unsupported storage provider: ${provider}`,
    'O provedor de armazenamento solicitado não é suportado.',
  );
}

export async function deleteMedia(provider: StorageProvider, keyOrUrl: string | null | undefined) {
  if (!keyOrUrl || provider === 'CANVA') return;
  if (provider === 'CLOUDFLARE_R2') {
    const r2 = getR2StorageConfig();
    try {
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: keyOrUrl }));
    } catch (error) {
      console.error('[MediaStorage] R2 delete failed', {
        key: keyOrUrl,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw new MediaStorageError(
        'R2_DELETE_FAILED',
        error instanceof Error ? error.message : String(error),
        'Não foi possível remover a imagem anterior do Cloudflare R2.',
      );
    }
    return;
  }
  throw new MediaStorageError(
    'UNSUPPORTED_STORAGE_PROVIDER',
    `Unsupported storage provider: ${provider}`,
    'O provedor de armazenamento solicitado não é suportado.',
  );
}
