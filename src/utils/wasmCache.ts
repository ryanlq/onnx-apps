/**
 * WASM 文件缓存服务
 * 使用 IndexedDB 存储从 CDN 加载的 WASM 文件
 */

const WASM_CACHE_DB = 'onnx-wasm-cache';
const WASM_CACHE_STORE = 'wasm-files';
const WASM_CACHE_VERSION = 1;

// CDN 配置
const WASM_CDN_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

interface CacheEntry {
  name: string;
  data: ArrayBuffer;
  timestamp: number;
  version: string;
}

/**
 * 初始化 IndexedDB 数据库
 */
async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WASM_CACHE_DB, WASM_CACHE_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建对象仓库
      if (!db.objectStoreNames.contains(WASM_CACHE_STORE)) {
        const store = db.createObjectStore(WASM_CACHE_STORE, { keyPath: 'name' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * 从 CDN 获取 WASM 文件
 */
async function fetchWasmFromCDN(filename: string): Promise<ArrayBuffer> {
  const url = WASM_CDN_BASE + filename;

  console.log(`📥 从 CDN 获取 WASM 文件: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch WASM from CDN: ${response.status} ${response.statusText}`);
  }

  if (!response.headers.get('Content-Type')?.includes('application/wasm')) {
    console.warn(`⚠️  CDN 响应的 Content-Type 不是 application/wasm:`, response.headers.get('Content-Type'));
  }

  return response.arrayBuffer();
}

/**
 * 将 WASM 文件保存到 IndexedDB
 */
async function saveWasmToCache(name: string, data: ArrayBuffer): Promise<void> {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([WASM_CACHE_STORE], 'readwrite');
    const store = transaction.objectStore(WASM_CACHE_STORE);

    const entry: CacheEntry = {
      name,
      data,
      timestamp: Date.now(),
      version: '1.22.0'
    };

    const request = store.put(entry);

    request.onsuccess = () => {
      console.log(`✅ WASM 文件已缓存: ${name} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 从 IndexedDB 读取 WASM 文件
 */
async function getWasmFromCache(name: string): Promise<ArrayBuffer | null> {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([WASM_CACHE_STORE], 'readonly');
    const store = transaction.objectStore(WASM_CACHE_STORE);
    const request = store.get(name);

    request.onsuccess = () => {
      const entry: CacheEntry | undefined = request.result;
      if (entry?.data) {
        console.log(`✅ 从缓存加载 WASM: ${name}`);
        resolve(entry.data);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 预加载并缓存 WASM 文件
 * 在首页调用，确保 WASM 文件在 Worker 使用前已经准备好
 */
export async function preloadWasmFiles(): Promise<void> {
  // ONNX Runtime Web 1.22.0 使用 threaded 版本
  const wasmFiles = [
    'ort-wasm-simd-threaded.jsep.wasm',  // 主 WASM 文件 (21 MB)
    'ort-wasm-simd-threaded.wasm'         // 备用 WASM 文件 (11 MB)
  ];

  console.log('🔄 开始预加载 WASM 文件...');

  for (const filename of wasmFiles) {
    try {
      // 检查缓存是否存在
      const cached = await getWasmFromCache(filename);

      if (!cached) {
        // 从 CDN 获取并缓存
        const data = await fetchWasmFromCDN(filename);
        await saveWasmToCache(filename, data);
      } else {
        console.log(`✓ ${filename} 已存在缓存`);
      }
    } catch (error) {
      console.error(`❌ 预加载 ${filename} 失败:`, error);
      // 不抛出错误，继续加载其他文件
      console.warn(`⚠️  将在运行时从 CDN 加载 ${filename}`);
    }
  }

  console.log('✅ WASM 文件预加载完成');
}

/**
 * 获取缓存的 WASM 文件，用于 Worker 加载
 * 返回 Blob URL，可以直接在 Worker 中使用
 */
export async function getCachedWasmAsBlobUrl(filename: string): Promise<string> {
  const data = await getWasmFromCache(filename);

  if (!data) {
    throw new Error(`WASM file not found in cache: ${filename}`);
  }

  const blob = new Blob([data], { type: 'application/wasm' });
  return URL.createObjectURL(blob);
}

/**
 * 清除过期的缓存（可选）
 */
export async function clearOldCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const db = await initDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([WASM_CACHE_STORE], 'readwrite');
    const store = transaction.objectStore(WASM_CACHE_STORE);
    const index = store.index('timestamp');

    const range = IDBKeyRange.upperBound(now - maxAgeMs);
    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        console.log(`🗑️  删除过期缓存: ${cursor.value.name}`);
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取缓存状态信息
 */
export async function getCacheStatus(): Promise<{ files: string[], totalSize: number }> {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([WASM_CACHE_STORE], 'readonly');
    const store = transaction.objectStore(WASM_CACHE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const entries: CacheEntry[] = request.result || [];
      const totalSize = entries.reduce((sum, entry) => sum + entry.data.byteLength, 0);
      resolve({
        files: entries.map(e => e.name),
        totalSize
      });
    };
    request.onerror = () => reject(request.error);
  });
}
