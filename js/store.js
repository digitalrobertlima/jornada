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
import { newAction, recordInverse, buildUndo } from './engines/journal.js';
import { uid } from './core/util.js';

const JOURNAL_MAX = 60;

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
    this.meta.journal = await vault.getMeta('journal', []);
    this.meta.google = await vault.getMeta('google', null);
    this.meta.lastSync = await vault.getMeta('lastSync', null);
    this.meta.lastLocalChange = await vault.getMeta('lastLocalChange', 0);
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

  /**
   * Grava mudanças. Com `label`, a ação entra no diário e pode ser desfeita por inteiro.
   * Com `actionId`, junta-se a uma ação já aberta (ex.: entrada + pagamento do "Entrou dinheiro").
   */
  async commit(changes, { render = true, label = null, actionId = null } = {}) {
    let action = null;
    if (label || actionId) {
      const journal = this.meta.journal || [];
      action = actionId ? journal.find((a) => a.id === actionId) : null;
      if (!action) action = newAction(actionId || uid('act'), label || 'Ação');
      recordInverse(action, this.state, changes);
      this.meta.journal = [action, ...journal.filter((a) => a.id !== action.id)].slice(0, JOURNAL_MAX);
    }
    await vault.commit(changes);
    this.merge(changes);
    if (action) {
      await vault.setMeta('journal', this.meta.journal);
      this.meta.lastLocalChange = Date.now();
      await vault.setMeta('lastLocalChange', this.meta.lastLocalChange);
    }
    if (render) this.onChange();
    if (action && !actionId) this.onAction(action);
    return action;
  },

  onAction: () => {},

  /** Ação do diário que criou um lançamento (para o "desfazer" do fluxo diário). */
  actionForLedger(entryId) {
    return (this.meta.journal || []).find((a) => a.created.ledger.includes(entryId)) || null;
  },

  async undo(actionId) {
    const action = (this.meta.journal || []).find((a) => a.id === actionId);
    if (!action) throw new Error('Esta ação já foi desfeita ou é antiga demais.');
    const changes = buildUndo(action, this.state);
    this.meta.journal = this.meta.journal.filter((a) => a.id !== actionId);
    await vault.commit(changes);
    this.merge(changes);
    await vault.setMeta('journal', this.meta.journal);
    this.meta.lastLocalChange = Date.now();
    await vault.setMeta('lastLocalChange', this.meta.lastLocalChange);
    this.onChange();
    return action;
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
    this.meta.journal = [];
    await vault.setMeta('journal', []);
    this.meta.lastLocalChange = Date.now();
    await vault.setMeta('lastLocalChange', this.meta.lastLocalChange);
    this.version++;
  },

  async clearAll() {
    await vault.clearAll();
    this.state = { household: null, profiles: [], accounts: [], obligations: [], ledger: [] };
    this.meta = { activeProfileId: null, demo: false, market: this.meta.market, liveMarket: true, manual: {}, journal: [] };
    await vault.setMeta('market', this.meta.market);
    this.version++;
  },
};
