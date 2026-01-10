/**
 * IndexedDB Storage for Water Removal Reader
 * 替代 localStorage 以支持更大的存储容量（无 3MB 限制）
 */

const DB_NAME = 'WaterRemovalReaderDB';
const DB_VERSION = 1;

// 存储的对象存储名称
const STORE_BOOK = 'book';
const STORE_BATCH_PROGRESS = 'batchProgress';

// 打开数据库
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] 打开数据库失败:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('[IndexedDB] 数据库打开成功');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建书籍存储
      if (!db.objectStoreNames.contains(STORE_BOOK)) {
        const bookStore = db.createObjectStore(STORE_BOOK, { keyPath: 'id' });
        bookStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('[IndexedDB] 创建书籍存储');
      }

      // 创建批处理进度存储
      if (!db.objectStoreNames.contains(STORE_BATCH_PROGRESS)) {
        const batchStore = db.createObjectStore(STORE_BATCH_PROGRESS, { keyPath: 'id' });
        batchStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('[IndexedDB] 创建批处理进度存储');
      }
    };
  });
};

// ========== 书籍数据存储 ==========

export interface BookData {
  id: string; // 固定为 'current'
  rawText: string;
  chapters: any[];
  currentChapter: number;
  timestamp: number;
  bookTitle: string;
  fileName: string;
  // 配置
  readMode: 'normal' | 'original';
  waterRemovalLevel: string;
  keepThreshold: number;
  foldThreshold: number;
  protectDialogue: boolean;
}

/**
 * 保存书籍数据到 IndexedDB
 */
export const saveBookData = async (bookData: BookData): Promise<boolean> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BOOK], 'readwrite');
    const store = transaction.objectStore(STORE_BOOK);

    // 使用 put 保存数据（insert or update）
    store.put(bookData);

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        const size = new Blob([JSON.stringify(bookData)]).size;
        console.log(`[IndexedDB] 书籍保存成功，大小: ${Math.round(size / 1024)} KB`);
        resolve(true);
      };

      transaction.onerror = () => {
        console.error('[IndexedDB] 书籍保存失败:', transaction.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] 保存书籍时出错:', error);
    return false;
  }
};

/**
 * 从 IndexedDB 加载书籍数据
 */
export const loadBookData = async (): Promise<BookData | null> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BOOK], 'readonly');
    const store = transaction.objectStore(STORE_BOOK);
    const request = store.get('current');

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        const data = request.result;
        if (data) {
          // 检查数据是否在30天内
          const daysSinceUpdate = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate <= 30) {
            console.log(`[IndexedDB] 成功加载书籍: ${data.bookTitle}`);
            resolve(data);
          } else {
            // 过期数据，删除
            deleteBookData();
            console.log('[IndexedDB] 书籍数据已过期');
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      transaction.onerror = () => {
        console.error('[IndexedDB] 加载书籍失败:', transaction.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] 加载书籍时出错:', error);
    return null;
  }
};

/**
 * 删除书籍数据
 */
export const deleteBookData = async (): Promise<void> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BOOK], 'readwrite');
    const store = transaction.objectStore(STORE_BOOK);
    store.delete('current');

    transaction.oncomplete = () => {
      console.log('[IndexedDB] 书籍数据已删除');
    };
  } catch (error) {
    console.error('[IndexedDB] 删除书籍时出错:', error);
  }
};

// ========== 批处理进度存储 ==========

export interface BatchProgressData {
  id: string; // 固定为 'current'
  chapters: any[];
  timestamp: number;
  totalChapters: number;
  processedCount: number;
}

/**
 * 保存批处理进度
 */
export const saveBatchProgress = async (chapters: any[]): Promise<void> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BATCH_PROGRESS], 'readwrite');
    const store = transaction.objectStore(STORE_BATCH_PROGRESS);

    const data: BatchProgressData = {
      id: 'current',
      chapters,
      timestamp: Date.now(),
      totalChapters: chapters.length,
      processedCount: chapters.filter((ch) => ch.paragraphs && ch.paragraphs.length > 0).length,
    };

    store.put(data);

    transaction.oncomplete = () => {
      console.log('[IndexedDB] 批处理进度已保存');
    };
  } catch (error) {
    console.error('[IndexedDB] 保存批处理进度时出错:', error);
  }
};

/**
 * 加载批处理进度
 */
export const loadBatchProgress = async (): Promise<BatchProgressData | null> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BATCH_PROGRESS], 'readonly');
    const store = transaction.objectStore(STORE_BATCH_PROGRESS);
    const request = store.get('current');

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        const data = request.result;
        if (data) {
          // 检查数据是否在7天内
          const daysSinceUpdate = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate <= 7) {
            console.log('[IndexedDB] 批处理进度已加载');
            resolve(data);
          } else {
            // 过期数据，删除
            deleteBatchProgress();
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      transaction.onerror = () => {
        console.error('[IndexedDB] 加载批处理进度失败:', transaction.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] 加载批处理进度时出错:', error);
    return null;
  }
};

/**
 * 删除批处理进度
 */
export const deleteBatchProgress = async (): Promise<void> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_BATCH_PROGRESS], 'readwrite');
    const store = transaction.objectStore(STORE_BATCH_PROGRESS);
    store.delete('current');

    transaction.oncomplete = () => {
      console.log('[IndexedDB] 批处理进度已删除');
    };
  } catch (error) {
    console.error('[IndexedDB] 删除批处理进度时出错:', error);
  }
};

/**
 * 清除所有数据（书籍 + 批处理进度）
 */
export const clearAllData = async (): Promise<void> => {
  try {
    await Promise.all([deleteBookData(), deleteBatchProgress()]);
    console.log('[IndexedDB] 所有数据已清除');
  } catch (error) {
    console.error('[IndexedDB] 清除数据时出错:', error);
  }
};

/**
 * 获取存储使用情况（估算）
 */
export const getStorageInfo = async (): Promise<{ bookSize: number; batchSize: number }> => {
  try {
    const db = await openDB();
    const bookData = await new Promise<BookData | null>((resolve) => {
      const transaction = db.transaction([STORE_BOOK], 'readonly');
      const store = transaction.objectStore(STORE_BOOK);
      const request = store.get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => resolve(null);
    });

    const batchData = await new Promise<BatchProgressData | null>((resolve) => {
      const transaction = db.transaction([STORE_BATCH_PROGRESS], 'readonly');
      const store = transaction.objectStore(STORE_BATCH_PROGRESS);
      const request = store.get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => resolve(null);
    });

    const bookSize = bookData ? new Blob([JSON.stringify(bookData)]).size : 0;
    const batchSize = batchData ? new Blob([JSON.stringify(batchData)]).size : 0;

    return { bookSize, batchSize };
  } catch (error) {
    console.error('[IndexedDB] 获取存储信息时出错:', error);
    return { bookSize: 0, batchSize: 0 };
  }
};
