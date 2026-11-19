// Diário de ações: cada ação do usuário (pagar, lançar, cadastrar, "entrou dinheiro"…)
// guarda o necessário para ser desfeita POR INTEIRO, mesmo depois de outras ações.
//
// - Contas e perfis: guardamos DIFERENÇAS (deltas) dos números. Desfazer subtrai a diferença
//   do valor atual, então ações posteriores não são perdidas.
// - Dívidas e casa: guardamos a versão anterior (fotografia) e restauramos.
// - Registros criados pela ação são apagados; registros apagados por ela voltam.

const ACC_FIELDS = ['balance', 'limitAvailable', 'limitTotal', 'collateralTotal', 'lockedInstallments',
  'satsFromYield', 'satsFromCashback', 'cashbackPendingBRL', 'cashbackBRLTotal'];
const PROF_FIELDS = ['rescuedLifeMinutes', 'accumulatedSats'];
const PROF_LOGS = ['rescueLog', 'satsLog'];
const KEYS = ['household', 'profiles', 'accounts', 'obligations', 'ledger', 'recipes'];
const REMOVALS = { removeLedger: 'ledger', removeObligations: 'obligations', removeAccounts: 'accounts', removeProfiles: 'profiles', removeRecipes: 'recipes' };

const r2 = (x) => Math.round((Number(x) || 0) * 1e6) / 1e6;

function emptyAction(id, label, at) {
  return {
    id, label, at,
    created: { profiles: [], accounts: [], obligations: [], ledger: [], recipes: [] },
    removed: { profiles: [], accounts: [], obligations: [], ledger: [], recipes: [] },
    accountDeltas: {}, profileDeltas: {}, profileLogIds: {},
    priorObligations: {}, priorHousehold: null,
  };
}

/** Registra no `action` o inverso de `changes` aplicadas sobre `state` (estado ANTES das mudanças). */
export function recordInverse(action, state, changes) {
  const createdNow = (key, id) => action.created[key]?.includes(id);
  for (const key of KEYS) {
    for (const rec of changes[key] || []) {
      if (key === 'household') {
        if (!action.priorHousehold) action.priorHousehold = state.household ? { ...state.household } : { id: 'main', name: 'Minha Casa' };
        continue;
      }
      const prior = (state[key] || []).find((r) => r.id === rec.id);
      if (!prior) {
        if (!action.created[key]) action.created[key] = [];
        if (!createdNow(key, rec.id)) action.created[key].push(rec.id);
        continue;
      }
      if (createdNow(key, rec.id)) continue; // criado nesta mesma ação: some inteiro no desfazer
      if (key === 'accounts') {
        const d = action.accountDeltas[rec.id] || (action.accountDeltas[rec.id] = {});
        for (const f of ACC_FIELDS) {
          const diff = r2((Number(rec[f]) || 0) - (Number(prior[f]) || 0));
          if (diff) d[f] = r2((d[f] || 0) + diff);
        }
      } else if (key === 'profiles') {
        const d = action.profileDeltas[rec.id] || (action.profileDeltas[rec.id] = {});
        for (const f of PROF_FIELDS) {
          const diff = r2((Number(rec[f]) || 0) - (Number(prior[f]) || 0));
          if (diff) d[f] = r2((d[f] || 0) + diff);
        }
        const logs = action.profileLogIds[rec.id] || (action.profileLogIds[rec.id] = {});
        for (const L of PROF_LOGS) {
          const before = new Set((prior[L] || []).map((x) => x.id));
          const added = (rec[L] || []).map((x) => x.id).filter((id) => id && !before.has(id));
          if (added.length) logs[L] = [...(logs[L] || []), ...added];
        }
      } else if (key === 'obligations' || key === 'ledger' || key === 'recipes') {
        const bucket = key === 'obligations' ? action.priorObligations
          : key === 'ledger' ? (action.priorLedger || (action.priorLedger = {})) : (action.priorRecipes || (action.priorRecipes = {}));
        if (!bucket[rec.id]) bucket[rec.id] = structuredClone(prior);
      }
    }
  }
  for (const [rk, key] of Object.entries(REMOVALS)) {
    for (const id of changes[rk] || []) {
      if (createdNow(key, id)) {
        action.created[key] = action.created[key].filter((x) => x !== id);
        continue;
      }
      const prior = (state[key] || []).find((r) => r.id === id);
      if (!action.removed[key]) action.removed[key] = [];
      const snap = key === 'obligations' ? action.priorObligations?.[id] : key === 'recipes' ? action.priorRecipes?.[id] : null;
      if (prior) action.removed[key].push(structuredClone(snap || prior));
    }
  }
  return action;
}

export function newAction(id, label) {
  return emptyAction(id, label, new Date().toISOString());
}

/** Monta as mudanças que desfazem `action` sobre o estado ATUAL. */
export function buildUndo(action, state) {
  const ch = { profiles: [], accounts: [], obligations: [], ledger: [], recipes: [], household: [], removeLedger: [], removeObligations: [], removeAccounts: [], removeProfiles: [], removeRecipes: [] };
  ch.removeLedger.push(...action.created.ledger);
  ch.removeObligations.push(...action.created.obligations);
  ch.removeAccounts.push(...action.created.accounts);
  ch.removeProfiles.push(...action.created.profiles);
  ch.removeRecipes.push(...(action.created.recipes || []));

  for (const [id, d] of Object.entries(action.accountDeltas)) {
    const cur = state.accounts.find((a) => a.id === id);
    if (!cur) continue;
    const next = { ...cur };
    for (const [f, diff] of Object.entries(d)) next[f] = Math.round(((Number(next[f]) || 0) - diff) * 100) / 100;
    if (next.type === 'collateralized_yield_crypto') next.limitAvailable = Math.round((next.collateralTotal - next.lockedInstallments) * 100) / 100;
    ch.accounts.push(next);
  }
  for (const [id, prior] of Object.entries(action.priorObligations)) ch.obligations.push(structuredClone(prior));
  for (const [id, prior] of Object.entries(action.priorLedger || {})) ch.ledger.push(structuredClone(prior));
  for (const [id, prior] of Object.entries(action.priorRecipes || {})) {
    if (!(action.removed.recipes || []).some((r) => r.id === id)) ch.recipes.push(structuredClone(prior));
  }
  const pids = new Set([...Object.keys(action.profileDeltas), ...Object.keys(action.profileLogIds)]);
  for (const id of pids) {
    const cur = state.profiles.find((p) => p.id === id);
    if (!cur) continue;
    const next = { ...cur };
    for (const [f, diff] of Object.entries(action.profileDeltas[id] || {})) next[f] = Math.max(0, r2((Number(next[f]) || 0) - diff));
    for (const [L, ids] of Object.entries(action.profileLogIds[id] || {})) next[L] = (next[L] || []).filter((x) => !ids.includes(x.id));
    ch.profiles.push(next);
  }
  for (const key of ['profiles', 'accounts', 'obligations', 'ledger', 'recipes']) {
    for (const rec of action.removed[key] || []) ch[key].push(structuredClone(rec));
  }
  if (action.priorHousehold) ch.household.push(action.priorHousehold);
  return ch;
}

/** Resumo legível do que será desfeito. */
export function describeAction(action, state) {
  const lines = [];
  for (const id of action.created.ledger) {
    const e = state.ledger.find((x) => x.id === id);
    if (e) lines.push(`${e.direction === 'in' ? 'Entrada' : 'Saída'} de R$ ${e.amount.toFixed(2).replace('.', ',')} · ${e.note || e.category}`);
  }
  const restored = new Set();
  for (const [id, prior] of Object.entries(action.priorObligations)) {
    restored.add(prior.beneficiary);
    lines.push(`${prior.beneficiary} volta a ficar como estava${prior.status === 'open' ? ' (em aberto)' : ''}`);
  }
  for (const id of action.created.obligations) {
    const o = state.obligations.find((x) => x.id === id);
    if (o && !restored.has(o.beneficiary)) lines.push(`Remove o cadastro: ${o.beneficiary}`);
  }
  for (const rec of action.removed.obligations) lines.push(`Restaura: ${rec.beneficiary}`);
  for (const id of action.created.recipes || []) {
    const r = (state.recipes || []).find((x) => x.id === id);
    if (r) lines.push(`Remove a peça: ${r.title}`);
  }
  for (const [id, prior] of Object.entries(action.priorRecipes || {})) {
    if (!(action.created.recipes || []).includes(id)) lines.push(`Peça "${prior.title}" volta como estava`);
  }
  for (const rec of action.removed.recipes || []) lines.push(`Restaura a peça: ${rec.title}`);
  for (const [id, d] of Object.entries(action.profileDeltas)) {
    if (d.rescuedLifeMinutes) lines.push(`Horas de vida: −${Math.round(d.rescuedLifeMinutes)} min`);
  }
  return [...new Set(lines)];
}
