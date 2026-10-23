// Local, separate from project undo/autosave. Media never lives in localStorage.
const DB = 'previz-reference-versions', LIMIT = 20;
const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = t => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onabort = t.onerror = () => reject(t.error || Error('本地版本写入失败')); });
export class ReferenceStore {
  async open() {
    if (this.db) return this.db; if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('media', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => { this.db.close(); this.db = null; this.opening = null; }; resolve(this.db); }; r.onerror = () => reject(r.error);
    }).catch(e => { this.opening = null; throw e; }); return this.opening;
  }
  async list() { const db = await this.open(), tx = db.transaction('meta'); return (await request(tx.objectStore('meta').getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async save(meta, media) {
    if ((await this.list()).length >= LIMIT) throw Error('本地参考版本已达 20 个，请先下载并删除旧版本');
    const db = await this.open(), tx = db.transaction(['meta', 'media'], 'readwrite'), wait = done(tx); tx.objectStore('meta').put(meta); tx.objectStore('media').put({ ...media, id: meta.id }); await wait;
  }
  async get(id) { const db = await this.open(), tx = db.transaction(['meta', 'media']); const [meta, media] = await Promise.all([request(tx.objectStore('meta').get(id)), request(tx.objectStore('media').get(id))]); if (!meta || !media) throw Error('本地版本不存在'); return { meta, media }; }
  async update(id, patch, mediaPatch = {}) {
    const db = await this.open(), withMedia = Object.keys(mediaPatch).length > 0;
    const tx = db.transaction(withMedia ? ['meta', 'media'] : ['meta'], 'readwrite'), wait = done(tx);
    const meta = await request(tx.objectStore('meta').get(id)); if (!meta) { tx.abort(); await wait; return; }
    for (const k of ['resultName', 'resultURL', 'scores', 'notes', 'generation', 'sync']) if (Object.hasOwn(patch, k)) meta[k] = patch[k];
    tx.objectStore('meta').put(meta);
    if (withMedia) { const media = await request(tx.objectStore('media').get(id)); if (!media) { tx.abort(); await wait; return; } tx.objectStore('media').put({ ...media, ...mediaPatch, id }); }
    await wait;
  }
  async delete(id) { const db = await this.open(), tx = db.transaction(['meta', 'media'], 'readwrite'), wait = done(tx); tx.objectStore('meta').delete(id); tx.objectStore('media').delete(id); await wait; }
}
