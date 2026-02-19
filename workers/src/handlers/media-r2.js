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

  if (action === 'serve') {
    return handleServe(request, env, url);
  }

  return errorResponse('Invalid action. Use ?action=upload or ?action=serve', 'BAD_REQUEST', 400);
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
