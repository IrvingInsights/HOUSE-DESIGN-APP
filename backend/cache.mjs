import crypto from 'node:crypto';

const memoryCache = new Map();

export function makeCacheKey(parts) {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

export function getCached(cacheKey) {
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

export function setCached(cacheKey, value, ttlMs = 5 * 60 * 1000) {
  memoryCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  return value;
}
