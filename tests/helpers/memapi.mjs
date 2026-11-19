// API em memória para testar ferramentas e o assistente sem navegador.
import { triage } from '../../js/engines/triage.js';
import { waterline, realLiquidity, liquidityBreakdown } from '../../js/engines/cashflow.js';
import { evaluateEras } from '../../js/engines/eraMachine.js';
import { realHourlyRate } from '../../js/engines/lifeHours.js';
import { newAction, recordInverse, buildUndo } from '../../js/engines/journal.js';
import { applyRules } from '../../js/recipes/model.js';

export function derive(s, pid, today) {
  const profile = s.profiles.find((p) => p.id === pid);
  const tri = triage(s, pid, today);
  const wl = waterline(s, pid, today, tri);
  const cash = realLiquidity(s, pid);
  const eras = evaluateEras({ tri, wl, cash, shieldTarget: profile.shieldTarget, sats: 0, baselines: {} });
  return { profile, tri, wl, cash, liq: liquidityBreakdown(s, pid), eras, rate: realHourlyRate(profile), today, pid };
}

function applyInPlace(s, changes) {
  for (const key of ['accounts', 'obligations', 'ledger', 'profiles', 'recipes']) {
    for (const rec of changes[key] || []) {
      s[key] = s[key] || [];
      const i = s[key].findIndex((r) => r.id === rec.id);
      if (i >= 0) s[key][i] = rec; else s[key].push(rec);
    }
  }
  const rm = { removeLedger: 'ledger', removeRecipes: 'recipes', removeObligations: 'obligations', removeAccounts: 'accounts', removeProfiles: 'profiles' };
  for (const [rk, key] of Object.entries(rm)) if (changes[rk]?.length) s[key] = s[key].filter((e) => !changes[rk].includes(e.id));
}

export function memApi(state, pid, today) {
  const journal = [];
  const requests = [];
  let n = 0;
  return {
    requests,
    state: () => state,
    today: () => today,
    derive: () => derive(state, pid, today),
    btcPrice: () => 420000,
    journal: () => journal,
    async commit(changes, { label } = {}) {
      let notes = [];
      if (label) ({ changes, notes } = applyRules(state, changes));
      let a = null;
      if (label) { a = newAction(`act${++n}`, label); recordInverse(a, state, changes); journal.unshift(a); }
      applyInPlace(state, changes);
      if (a) a.notes = notes;
      return a;
    },
    async undo(id) {
      const a = journal.find((x) => x.id === id);
      applyInPlace(state, buildUndo(a, state));
      journal.splice(journal.indexOf(a), 1);
    },
    async addRequest(text) { requests.push(text); },
  };
}
