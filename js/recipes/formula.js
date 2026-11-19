// Fórmula segura: só números, + − × ÷, parênteses, variáveis permitidas e min/max/arred.
// Nada de eval: um analisador pequeno que não consegue executar código, acessar dados ou a rede.

const FUNCS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  arred: (x, casas = 0) => {
    const f = 10 ** Math.max(0, Math.min(6, Math.round(casas)));
    return Math.round(x * f) / f;
  },
  abs: (x) => Math.abs(x),
};

function tokenize(src) {
  const s = String(src || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      // vírgula/ponto só fazem parte do número se vier dígito logo depois (senão separam argumentos)
      while (j < s.length && (/[0-9]/.test(s[j]) || (/[.,]/.test(s[j]) && /[0-9]/.test(s[j + 1] || '')))) j++;
      let raw = s.slice(i, j);
      // pt-BR: 1.250,50 → 1250.50 ; 2,5 → 2.5 ; 12.5 → 12.5
      if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Número inválido: ${s.slice(i, j)}`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (/[a-zA-ZÀ-ÿ_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-ZÀ-ÿ_0-9]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() });
      i = j;
      continue;
    }
    if (c === ';') { out.push({ t: ',' }); i++; continue; }
    if ('+-*/(),%'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Símbolo não permitido: "${c}"`);
  }
  if (out.length > 200) throw new Error('Fórmula longa demais.');
  return out;
}

/** Avalia `expr` com as variáveis de `vars`. Lança erro com mensagem em português. */
export function evaluate(expr, vars = {}) {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => {
    if (toks[p]?.t !== t) throw new Error(`Esperava "${t}" na fórmula.`);
    return toks[p++];
  };
  const expression = () => {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[p++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = () => {
    let v = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = toks[p++].t;
      const r = unary();
      if (op === '/' && r === 0) throw new Error('Divisão por zero.');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const unary = () => {
    if (peek()?.t === '-') { p++; return -unary(); }
    if (peek()?.t === '+') { p++; return unary(); }
    let v = primary();
    if (peek()?.t === '%') { p++; v /= 100; }
    return v;
  };
  const primary = () => {
    const tk = toks[p++];
    if (!tk) throw new Error('Fórmula incompleta.');
    if (tk.t === 'num') return tk.v;
    if (tk.t === '(') { const v = expression(); take(')'); return v; }
    if (tk.t === 'id') {
      if (peek()?.t === '(') {
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error(`Função desconhecida: ${tk.v}`);
        p++;
        const args = [];
        if (peek()?.t !== ')') {
          args.push(expression());
          while (peek()?.t === ',') { p++; args.push(expression()); }
        }
        take(')');
        return fn(...args);
      }
      if (!Object.prototype.hasOwnProperty.call(vars, tk.v)) {
        const known = Object.keys(vars);
        throw new Error(`Não conheço "${tk.v}".${known.length ? ` Use: ${known.join(', ')}.` : ''}`);
      }
      const v = Number(vars[tk.v]);
      if (!Number.isFinite(v)) throw new Error(`"${tk.v}" não tem valor agora.`);
      return v;
    }
    throw new Error('Fórmula mal escrita.');
  };
  const v = expression();
  if (p < toks.length) throw new Error('Sobrou algo no fim da fórmula.');
  if (!Number.isFinite(v)) throw new Error('Resultado inválido.');
  return Math.round(v * 1e6) / 1e6;
}

/** Variáveis que uma fórmula usa (para validar antes de salvar). */
export function variablesOf(expr) {
  const toks = tokenize(expr);
  return [...new Set(toks.filter((t, i) => t.t === 'id' && toks[i + 1]?.t !== '(').map((t) => t.v))];
}
