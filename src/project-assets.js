// Portable, content-addressed imported resources. Scene/undo records reference IDs;
// geometry and embedded images are written once to the project archive.
import * as THREE from 'three';
import { zip, unzip, strToU8, strFromU8 } from 'fflate';
const MAX_RESOURCE = 64 * 1024 * 1024, MAX_PROJECT = 192 * 1024 * 1024;
const ID = /^asset-[0-9a-f]{64}$/;
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function embedded(doc) {
  for (const image of doc.images || []) {
    for (const url of Array.isArray(image.url) ? image.url : [image.url]) {
      if (typeof url === 'string' && !/^data:image\//i.test(url)) throw new Error('贴图尚未内嵌，请连同模型的贴图文件一起导入');
    }
  }
}
function canonical(doc) {
  const ids = new Map();
  return JSON.stringify(doc).replace(uuid, id => {
    if (!ids.has(id)) ids.set(id, `resource-${ids.size}`);
    return ids.get(id);
  });
}
export class ProjectAssets {
  constructor() { this.records = new Map(); this.pending = new Set(); this.failures = []; }
  async register(root) {
    const doc = root.toJSON(); embedded(doc);
    const text = canonical(doc), bytes = strToU8(text);
    if (bytes.length > MAX_RESOURCE) throw new Error('模型资源超过 64MB 存档上限，请先减面或压缩贴图');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const id = 'asset-' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    this.records.set(id, text);
    return id;
  }
  hydrate(assets = {}) {
    let size = 0;
    const staged = [];
    for (const [id, doc] of Object.entries(assets)) {
      if (!ID.test(id)) throw new Error('工程模型资源 ID 无效');
      const text = typeof doc === 'string' ? doc : JSON.stringify(doc);
      size += text.length * 2;
      if (text.length > MAX_RESOURCE || size > MAX_PROJECT) throw new Error('工程模型资源过大');
      const data = JSON.parse(text);
      if (!data.object || !data.metadata) throw new Error('工程模型资源格式无效');
      embedded(data); staged.push([id, text]);
    }
    for (const [id, text] of staged) this.records.set(id, text);
  }
  instantiate(id) {
    if (!this.records.has(id)) return null;
    let resolve, reject;
    const ready = new Promise((res, rej) => { resolve = res; reject = rej; });
    const manager = new THREE.LoadingManager();
    manager.onError = () => reject(new Error('工程中的模型贴图无法解码'));
    // Each instance owns geometry/material/texture objects, including skeletons.
    // Deleting or changing one must not dispose a different instance's resources.
    const root = new THREE.ObjectLoader(manager).parse(JSON.parse(this.records.get(id)), resolve);
    this.pending.add(ready);
    ready.then(() => this.pending.delete(ready), err => { this.pending.delete(ready); this.failures.push(err); });
    return root;
  }
  async ready() {
    let failed;
    try { await Promise.all([...this.pending]); } catch (e) { failed = e; }
    const errors = this.failures.splice(0);
    if (failed || errors.length) throw failed || errors[0];
  }
  ids(objects) { return [...new Set(objects.map(o => o.params?.assetId).filter(Boolean))]; }
  export(objects) {
    const out = {};
    for (const id of this.ids(objects)) {
      if (!this.records.has(id)) throw new Error('缺少导入模型资源，请重新导入原模型后保存');
      out[id] = this.records.get(id);
    }
    return out;
  }
}
export async function packProject(app) {
  const doc = app.serialize({ assets: false });
  const files = { 'project.json': strToU8(JSON.stringify(doc)) };
  for (const [id, text] of Object.entries(app.projectAssets.export(app.objects))) files[`assets/${id}.json`] = strToU8(text);
  return new Promise((resolve, reject) => zip(files, { level: 6 }, (err, data) => err ? reject(err) : resolve(data)));
}
export async function unpackProject(bytes) {
  if (bytes.byteLength > MAX_PROJECT) throw new Error('工程包超过大小上限');
  let total = 0, entries = 0;
  const files = await new Promise((resolve, reject) => unzip(new Uint8Array(bytes), {
    filter: entry => {
      if (++entries > 10000) throw new Error('工程资源文件数量过多');
      if (entry.name !== 'project.json' && !/^assets\/asset-[0-9a-f]{64}\.json$/.test(entry.name)) return false;
      total += entry.originalSize;
      if (entry.originalSize > MAX_RESOURCE || total > MAX_PROJECT) throw new Error('工程解压后资源过大');
      return true;
    },
  }, (err, data) => err ? reject(err) : resolve(data)));
  if (!files['project.json']) throw new Error('不是有效的 Previz 工程包');
  const doc = JSON.parse(strFromU8(files['project.json']));
  if (!Array.isArray(doc.objects)) throw new Error('工程对象列表无效');
  doc.assets = {};
  for (const id of new Set(doc.objects.map(o => o.params?.assetId).filter(Boolean))) {
    if (!ID.test(id) || !files[`assets/${id}.json`]) throw new Error('工程包缺少模型资源：' + id);
    doc.assets[id] = strFromU8(files[`assets/${id}.json`]);
  }
  return doc;
}
// Resolve external GLTF/OBJ/MTL resources from the same local selection. Never
// silently fetch an unrelated URL when a companion file is missing.
export function localFileResources(files) {
  const byPath = new Map(), byName = new Map(), urls = new Map(), errors = [];
  for (const f of files) {
    const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/').replace(/^\.\//, '');
    byPath.set(path, f); const name = path.split('/').pop();
    if (!byName.has(name)) byName.set(name, []); byName.get(name).push(f);
  }
  let busy = false, finish = null, base = '';
  const normalize = p => { const parts=[]; for(const part of p.split('/')) { if(part==='..') parts.pop(); else if(part&&part!=='.')parts.push(part); } return parts.join('/'); };
  const file = url => { const path=decodeURIComponent(url).replace(/\\/g,'/'),name=path.split('/').pop(),matches=byName.get(name)||[]; return byPath.get(normalize(base+path))||byPath.get(normalize(path))||(matches.length===1?matches[0]:null); };
  const manager = new THREE.LoadingManager();
  manager.onStart = () => { busy = true; };
  manager.onLoad = () => { busy = false; finish?.(); finish = null; };
  manager.onError = url => errors.push(url);
  manager.setURLModifier(url => {
    if (/^(data:|blob:)/i.test(url)) return url;
    const path = decodeURIComponent(url).replace(/\\/g, '/').replace(/^\.\//, '');
    const f = file(url);
    if (!f) throw new Error(`缺少或重名的资源「${path}」，请连同模型依赖一起选择`);
    if (!urls.has(f)) urls.set(f, URL.createObjectURL(f));
    return urls.get(f);
  });
  return {
    manager, file,
    setBase(file) { const path = (file.webkitRelativePath || file.name).replace(/\\/g, '/'); base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''; },
    async ready() { if (busy) await new Promise(r => { finish = r; }); if (errors.length) throw new Error('模型贴图或依赖加载失败'); },
    dispose() { for (const u of urls.values()) URL.revokeObjectURL(u); },
  };
}
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('previz-resources', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('assets'); r.result.createObjectStore('project'); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('本地存储被其他页面阻塞'));
  });
}
export async function persistLocal(doc, records) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['assets', 'project'], 'readwrite'), store = tx.objectStore('assets');
      for (const [id, data] of Object.entries(records)) {
        const r = store.getKey(id); r.onsuccess = () => { if (r.result === undefined) store.put(data, id); };
      }
      tx.objectStore('project').put(doc, 'latest');
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地存储写入失败'));
    });
  } finally { db.close(); }
}
export async function restoreLocal() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['assets', 'project'], 'readonly'), r = tx.objectStore('project').get('latest');
      let doc = null;
      r.onsuccess = () => {
        doc = r.result || null;
        if (!doc) return;
        doc.assets = {};
        for (const id of new Set(doc.objects.map(o => o.params?.assetId).filter(Boolean))) {
          const a = tx.objectStore('assets').get(id); a.onsuccess = () => { if (a.result) doc.assets[id] = a.result; };
        }
      };
      tx.oncomplete = () => resolve(doc); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
