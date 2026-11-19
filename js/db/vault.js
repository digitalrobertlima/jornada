// Cofre local — IndexedDB, Schema v2.0.
// Stores: household, profiles, accounts, obligations, ledger (+ meta para ajustes).
// Nada sai do aparelho: backup é um arquivo .json que o próprio usuário guarda.

import { SCHEMA_VERSION, normalizeState } from '../core/model.js';

const DB_NAME = 'jornada-vault';
const DB_VERSION = 3;
export const STORES = ['household', 'profiles', 'accounts', 'obligations', 'ledger', 'recipes'];
const META = 'meta';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
}

export class Vault {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    if (!('indexedDB' in globalThis)) throw new Error('Este navegador não tem IndexedDB.');
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name !== 'household') store.createIndex('profileId', 'profileId', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    this.db = await req(open);
    this.db.onversionchange = () => this.db.close();
    // pede ao navegador para não apagar os dados sob pressão de espaço
    try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
    return this.db;
  }

  async getMeta(key, fallback = null) {
    const db = await this.open();
    const rec = await req(db.transaction(META).objectStore(META).get(key));
    return rec ? rec.value : fallback;
  }

  async setMeta(key, value) {
    const db = await this.open();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ key, value });
    await txDone(tx);
  }

  async loadAll() {
    const db = await this.open();
    const tx = db.transaction(STORES);
    const out = {};
    for (const name of STORES) out[name] = await req(tx.objectStore(name).getAll());
    return {
      household: out.household[0] || null,
      profiles: out.profiles,
      accounts: out.accounts,
      obligations: out.obligations,
      ledger: out.ledger,
      recipes: out.recipes,
    };
  }

  /** Grava várias mudanças de uma vez (atômico). changes: { store: [records], removeX: [ids] } */
  async commit(changes) {
    const db = await this.open();
    const tx = db.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      for (const rec of changes[name] || []) tx.objectStore(name).put(rec);
    }
    const removals = {
      ledger: changes.removeLedger, obligations: changes.removeObligations,
      accounts: changes.removeAccounts, profiles: changes.removeProfiles, recipes: changes.removeRecipes,
    };
    for (const [name, ids] of Object.entries(removals)) {
      for (const id of ids || []) tx.objectStore(name).delete(id);
    }
    await txDone(tx);
  }

  async clearAll() {
    const db = await this.open();
    const tx = db.transaction([...STORES, META], 'readwrite');
    for (const name of [...STORES, META]) tx.objectStore(name).clear();
    await txDone(tx);
  }

  async replaceAll(state, meta = {}) {
    const db = await this.open();
    const tx = db.transaction([...STORES, META], 'readwrite');
    for (const name of STORES) tx.objectStore(name).clear();
    if (state.household) tx.objectStore('household').put({ ...state.household, id: 'main' });
    for (const name of ['profiles', 'accounts', 'obligations', 'ledger', 'recipes']) {
      for (const rec of state[name] || []) tx.objectStore(name).put(rec);
    }
    for (const [key, value] of Object.entries(meta)) tx.objectStore(META).put({ key, value });
    await txDone(tx);
  }

  async exportBackup(settings = {}) {
    const data = await this.loadAll();
    return JSON.stringify({
      app: 'jornada',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      encrypted: false,
      data: { ...data, settings },
    }, null, 2);
  }

  /** Valida e devolve o estado normalizado de um backup (ou do formato do SPEC). */
  static parseBackup(text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Arquivo inválido: não é um JSON.');
    }
    if (json.encrypted) throw new Error('Backup cifrado: suporte chega na próxima versão.');
    const data = json.data || json; // aceita também o exemplo cru do SPEC.md
    if (!Array.isArray(data.profiles) || !data.profiles.length) throw new Error('Backup sem perfis.');
    const state = normalizeState(data);
    return { state, settings: data.settings || {} };
  }
}

export const vault = new Vault();
