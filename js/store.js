// Estado em memória + persistência no cofre local. Fonte única de verdade da interface.

import { vault } from './db/vault.js';
import { todayISO } from './core/dates.js';
import { normalizeState } from './core/model.js';
import { triage } from './engines/triage.js';
import {
  waterline, realLiquidity, liquidityBreakdown, householdCoverage,
} from './engines/cashflow.js';
import { evaluateEras } from './engines/eraMachine.js';
import { satsScore } from './engines/satsYield.js';
import { realHourlyRate } from './engines/lifeHours.js';

// Referência embutida, usada só até a primeira cotação ao vivo chegar (ou sem internet no 1º uso).
export const FALLBACK_MARKET = { btc: 420000, cdi: 14.15, label: 'referência offline (nov/2026)' };

const KEYS = ['household', 'profiles', 'accounts', 'obligations', 'ledger'];
const REMOVALS = { removeLedger: 'ledger', removeObligations: 'obligations', removeAccounts: 'accounts', removeProfiles: 'profiles' };

export const store = {
  state: { household: null, profiles: [], accounts: [], obligations: [], ledger: [] },
  meta: { activeProfileId: null, demo: false, market: {}, liveMarket: true, manual: {} },
  tab: 'hud',
  today: todayISO(),
  version: 0,
  onChange: () => {},
  _cache: null,

  get pid() {
    return this.meta.activeProfileId;
  },

  get profile() {
    return this.state.profiles.find((p) => p.id === this.pid) || null;
  },

  btcPrice() {
    return Number(this.meta.manual?.btc) || Number(this.meta.market?.btc?.value) || FALLBACK_MARKET.btc;
  },

  cdi() {
    return Number(this.meta.manual?.cdi) || Number(this.meta.market?.cdi?.value) || FALLBACK_MARKET.cdi;
  },

  async load() {
    await vault.open();
    const raw = await vault.loadAll();
    const norm = normalizeState({ ...raw, household: raw.household || {} });
    this.state = norm;
    this.meta.activeProfileId = await vault.getMeta('activeProfileId');
    this.meta.demo = await vault.getMeta('demo', false);
    this.meta.market = await vault.getMeta('market', {});
    this.meta.liveMarket = await vault.getMeta('liveMarket', true);
    this.meta.manual = await vault.getMeta('manual', {});
    this.meta.lastBackup = await vault.getMeta('lastBackup', null);
    if (!this.state.profiles.some((p) => p.id === this.meta.activeProfileId)) {
      this.meta.activeProfileId = this.state.profiles[0]?.id || null;
    }
    this.version++;
  },

  /** Cálculos derivados do perfil ativo (memorizados por versão). */
  derive(pid = this.pid) {
    if (this._cache && this._cache.version === this.version && this._cache.pid === pid && this._cache.today === this.today) {
      return this._cache.value;
    }
    const s = this.state;
    const today = this.today;
    const profile = s.profiles.find((p) => p.id === pid);
    if (!profile) return null;
    const tri = triage(s, pid, today);
    const wl = waterline(s, pid, today, tri);
    const cash = realLiquidity(s, pid);
    const liq = liquidityBreakdown(s, pid);
    const sats = satsScore(s, pid);
    const hasYieldCard = s.accounts.some((a) => a.profileId === pid && a.type === 'collateralized_yield_crypto');
    const eras = evaluateEras({
      tri, wl, cash, shieldTarget: profile.shieldTarget, sats: sats.total, hasYieldCard, baselines: profile.baselines,
    });
    const coverage = s.profiles.length > 1 ? householdCoverage(s, today) : null;
    const rate = realHourlyRate(profile);
    const value = { profile, tri, wl, cash, liq, sats, eras, coverage, rate, today, pid };
    this._cache = { version: this.version, pid, today, value };
    return value;
  },

  merge(changes) {
    for (const key of KEYS) {
      const list = changes[key];
      if (!list?.length) continue;
      if (key === 'household') {
        this.state.household = list[list.length - 1];
        continue;
      }
      for (const rec of list) {
        const arr = this.state[key];
        const i = arr.findIndex((r) => r.id === rec.id);
        if (i >= 0) arr[i] = rec;
        else arr.push(rec);
      }
    }
    for (const [rk, key] of Object.entries(REMOVALS)) {
      const ids = changes[rk];
      if (ids?.length) this.state[key] = this.state[key].filter((r) => !ids.includes(r.id));
    }
    this.version++;
  },

  async commit(changes, { render = true } = {}) {
    await vault.commit(changes);
    this.merge(changes);
    if (render) this.onChange();
  },

  async setMeta(key, value, { render = false } = {}) {
    this.meta[key] = value;
    await vault.setMeta(key, value);
    this.version++;
    if (render) this.onChange();
  },

  async replaceAll(state, meta = {}) {
    await vault.replaceAll(state, meta);
    this.state = state;
    Object.assign(this.meta, meta);
    this.version++;
  },

  async clearAll() {
    await vault.clearAll();
    this.state = { household: null, profiles: [], accounts: [], obligations: [], ledger: [] };
    this.meta = { activeProfileId: null, demo: false, market: this.meta.market, liveMarket: true, manual: {} };
    await vault.setMeta('market', this.meta.market);
    this.version++;
  },
};
