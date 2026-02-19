/**
 * Media R2 Handler - Upload/serve media files via Cloudflare R2
 *
 * Actions:
 *   POST ?action=upload  (multipart/form-data with "file" field)
 *   GET  ?action=serve&key=sop/...
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const IMAGE_MAX = 5 * 1024 * 1024;   // 5 MB
const VIDEO_MAX = 250 * 1024 * 1024;  // 250 MB

function isVideo(mime) {
  return mime.startsWith('video/');
}

export async function handleMediaR2(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'upload' && request.method === 'POST') {
    return handleUpload(request, env);
  }

  if (action === 'create-upload-url' && request.method === 'POST') {
    return handleCreateUploadUrl(request, env);
  }

  if (action === 'upload-part' && request.method === 'PUT') {
    return handleUploadPart(request, env, url);
  }

  if (action === 'confirm-upload' && request.method === 'POST') {
    return handleConfirmUpload(request, env);
  }

  if (action === 'serve') {
    return handleServe(request, env, url);
  }

  return errorResponse('Invalid action. Use ?action=upload, ?action=create-upload-url, or ?action=serve', 'BAD_REQUEST', 400);
}

async function handleUpload(request, env) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse('Invalid multipart/form-data', 'BAD_REQUEST', 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return errorResponse('Missing "file" field', 'BAD_REQUEST', 400);
  }

  const mime = file.type;
  const ext = ALLOWED_TYPES[mime];
  if (!ext) {
    return errorResponse(
      `Unsupported file type: ${mime}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      'BAD_REQUEST', 400
    );
  }

  const maxSize = isVideo(mime) ? VIDEO_MAX : IMAGE_MAX;
  if (file.size > maxSize) {
    const limitMB = Math.round(maxSize / 1024 / 1024);
    return errorResponse(`File too large (${limitMB}MB limit for ${isVideo(mime) ? 'video' : 'images'})`, 'BAD_REQUEST', 400);
  }

  // Generate unique key
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `sop/${timestamp}-${rand}.${ext}`;

  // Upload to R2 (stream to avoid memory limits on large files)
  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: mime },
    customMetadata: { originalName: file.name || key, size: String(file.size) },
  });

  // Build serve URL
  const baseUrl = new URL(request.url);
  const serveUrl = `${baseUrl.origin}/api/media?action=serve&key=${encodeURIComponent(key)}`;

  return jsonResponse({ success: true, url: serveUrl, key });
}

// --- Direct R2 upload via presigned URL (bypasses Worker body limits) ---

async function handleCreateUploadUrl(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { contentType, fileSize, fileName } = body;
  if (!contentType || !fileSize) {
    return errorResponse('Missing contentType or fileSize', 'BAD_REQUEST', 400);
  }

  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return errorResponse(
      `Unsupported file type: ${contentType}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      'BAD_REQUEST', 400
    );
  }

  const maxSize = isVideo(contentType) ? VIDEO_MAX : IMAGE_MAX;
  if (fileSize > maxSize) {
    const limitMB = Math.round(maxSize / 1024 / 1024);
    return errorResponse(`File too large (${limitMB}MB limit for ${isVideo(contentType) ? 'video' : 'images'})`, 'BAD_REQUEST', 400);
  }

  // Generate unique key
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `sop/${timestamp}-${rand}.${ext}`;

  // Create multipart upload for large files, or simple presigned PUT
  const mpu = await env.MEDIA_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType },
    customMetadata: { originalName: fileName || key, size: String(fileSize) },
  });

  return jsonResponse({
    success: true,
    key,
    uploadId: mpu.uploadId,
  });
}

async function handleUploadPart(request, env, url) {
  const key = url.searchParams.get('key');
  const uploadId = url.searchParams.get('uploadId');
  const partNumber = parseInt(url.searchParams.get('partNumber'), 10);

  if (!key || !uploadId || !partNumber) {
    return errorResponse('Missing key, uploadId, or partNumber', 'BAD_REQUEST', 400);
  }

  try {
    const mpu = env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await mpu.uploadPart(partNumber, request.body);
    return jsonResponse({ success: true, etag: part.etag });
  } catch (e) {
    return errorResponse('Part upload failed: ' + e.message, 'SERVER_ERROR', 500);
  }
}

async function handleConfirmUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { key, uploadId, parts } = body;
  if (!key || !uploadId || !parts) {
    return errorResponse('Missing key, uploadId, or parts', 'BAD_REQUEST', 400);
  }

  try {
    const mpu = env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
    await mpu.complete(parts);
  } catch (e) {
    return errorResponse('Failed to complete upload: ' + e.message, 'SERVER_ERROR', 500);
  }

  const baseUrl = new URL(request.url);
  const serveUrl = `${baseUrl.origin}/api/media?action=serve&key=${encodeURIComponent(key)}`;
  return jsonResponse({ success: true, url: serveUrl, key });
}

async function handleServe(request, env, url) {
  const key = url.searchParams.get('key');
  if (!key) {
    return errorResponse('Missing "key" parameter', 'BAD_REQUEST', 400);
  }

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return errorResponse('Not found', 'NOT_FOUND', 404);
  }

  // ETag / 304 support
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    return new Response(null, { status: 304 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { status: 200, headers });
}
