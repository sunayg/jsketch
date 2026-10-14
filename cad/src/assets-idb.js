// Imported meshes live in the browser's IndexedDB, keyed by content id
// (and by file name), so a design's `sculpt src=…` works after a reload.
// Works in the page and in the worker.
let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("jewelscript", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("assets");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("assets", mode);
    const r = fn(t.objectStore("assets"));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
export async function putAsset(id, record) {
  await tx("readwrite", (s) => {
    s.put(record, id);
    s.put(id, `name:${record.name}`);
  });
}
// by id, or by the file name it was imported under
export async function getAsset(src) {
  const id = /^[0-9a-f]{16}$/.test(src) ? src : await tx("readonly", (s) => s.get(`name:${src}`));
  return id ? tx("readonly", (s) => s.get(id)) : null;
}
