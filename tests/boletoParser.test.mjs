import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBoleto, factorToDate, dateToFactor, encodeBankBoleto, encodeCollectionBoleto, mod10, mod11Bank,
} from '../js/parsers/boletoParser.js';

const REF = '2026-11-19';

test('fator de vencimento: virada de 22/02/2025', () => {
  assert.equal(factorToDate(9999, '2025-02-20'), '2025-02-21');
  assert.equal(factorToDate(1000, '2025-03-01'), '2025-02-22');
  assert.equal(factorToDate(1001, REF), '2025-02-23');
  assert.equal(factorToDate(1002, REF), '2025-02-24');
  assert.equal(factorToDate(1638, REF), '2026-11-22');
  // mesmo fator, referência no ano 2000 → ciclo antigo
  assert.equal(factorToDate(1000, '2000-07-01'), '2000-07-03');
  assert.equal(factorToDate(1156, '2000-12-01'), '2000-12-06'); // exemplo do manual Santander
  assert.equal(factorToDate(0, REF), null);
  assert.equal(dateToFactor('2025-02-21'), 9999);
  assert.equal(dateToFactor('2025-02-22'), 1000);
  assert.equal(dateToFactor('2026-11-22'), 1638);
  assert.equal(dateToFactor('2027-12-31'), 2042);
});

test('fator: boletos de 2025 a 2034 decodificam exatamente', () => {
  let d = Date.UTC(2025, 1, 22);
  const end = Date.UTC(2034, 11, 31);
  while (d <= end) {
    const iso = new Date(d).toISOString().slice(0, 10);
    const f = dateToFactor(iso);
    // referência = 60 dias antes do vencimento (boleto emitido antes de vencer)
    const ref = new Date(d - 60 * 86400000).toISOString().slice(0, 10);
    assert.equal(factorToDate(f, ref), iso, `fator ${f}`);
    d += 86400000 * 7;
  }
});

test('linhas digitáveis reais (Itaú) passam na validação', () => {
  const a = parseBoleto('34191.09651 94497.312937 82957.690009 2 14370000676930', { reference: REF });
  assert.equal(a.isValid, true, a.errors.join('; '));
  assert.equal(a.bankCode, '341');
  assert.equal(a.bankName, 'Itaú');
  assert.equal(a.amount, 6769.30);
  assert.equal(a.dueFactor, 1437);
  assert.equal(a.dueDate, '2026-05-05');

  const b = parseBoleto('34191.75801 03928.662935 80573.180009 4 67700000007388', { reference: REF });
  assert.equal(b.isValid, true, b.errors.join('; '));
  assert.equal(b.amount, 73.88);
  assert.equal(b.dueDate, '2016-04-20'); // ciclo antigo: o mais próximo da referência

  const c = parseBoleto('34191.09008 72564.898723 32408.290008 1 10010000082831', { reference: REF });
  assert.equal(c.isValid, true, c.errors.join('; '));
  assert.equal(c.amount, 828.31);
  assert.equal(c.dueDate, '2025-02-23');
});

test('round-trip: linha 47 e código de barras 44 chegam ao mesmo resultado', () => {
  const { barcode, line } = encodeBankBoleto({ bankCode: '237', dueDate: '2026-11-22', amount: 600, freeField: '3381286000000000300000004' });
  assert.equal(line.length, 47);
  assert.equal(barcode.length, 44);
  const fromLine = parseBoleto(line, { reference: REF });
  const fromBar = parseBoleto(barcode, { reference: REF });
  for (const r of [fromLine, fromBar]) {
    assert.equal(r.isValid, true, r.errors.join('; '));
    assert.equal(r.bankCode, '237');
    assert.equal(r.bankName, 'Bradesco');
    assert.equal(r.dueDate, '2026-11-22');
    assert.equal(r.amount, 600);
    assert.equal(r.amountCents, 60000);
  }
  assert.equal(fromBar.line, line);
  assert.equal(fromLine.barcode, barcode);
});

test('dígito errado é detectado (campos e DV geral)', () => {
  const { line } = encodeBankBoleto({ bankCode: '001', dueDate: '2027-01-10', amount: 1234.56, freeField: '1234567890' });
  const flip = (s, i) => s.slice(0, i) + ((Number(s[i]) + 1) % 10) + s.slice(i + 1);
  assert.equal(parseBoleto(flip(line, 2)).isValid, false); // campo 1
  assert.equal(parseBoleto(flip(line, 15)).isValid, false); // campo 2
  assert.equal(parseBoleto(flip(line, 25)).isValid, false); // campo 3
  assert.equal(parseBoleto(flip(line, 40)).isValid, false); // valor → DV geral
});

test('exemplo do SPEC original (46 dígitos) é rejeitado com mensagem clara', () => {
  const r = parseBoleto('2379338128600000000030000000400119900000060000');
  assert.equal(r.isValid, false);
  assert.match(r.errors[0], /46/);
});

test('arrecadação 48 dígitos: mod 10 e mod 11', () => {
  for (const valueType of [6, 8]) {
    const enc = encodeCollectionBoleto({ segment: 3, valueType, amount: 186.4, companyId: '0055', freeField: '20261201998877665544' });
    assert.equal(enc.line.length, 48);
    const r = parseBoleto(enc.line, { reference: REF });
    assert.equal(r.isValid, true, r.errors.join('; '));
    assert.equal(r.kind, 'collection');
    assert.equal(r.segmentName, 'Energia elétrica e gás');
    assert.equal(r.amount, 186.4);
    assert.equal(r.dueDate, null);
    assert.equal(r.dueDateHint, '2026-12-01');
    const bar = parseBoleto(enc.barcode, { reference: REF });
    assert.equal(bar.isValid, true);
    assert.equal(bar.line, enc.line);
  }
});

test('módulos com vetores conhecidos', () => {
  assert.equal(mod10('341910965'), 1);
  assert.equal(mod11Bank('3419143700006769301096594497312938295769000'), 2);
});

test('desempenho: < 5ms por boleto', () => {
  const { line } = encodeBankBoleto({ dueDate: '2026-12-10', amount: 99.9 });
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) parseBoleto(line);
  assert.ok((performance.now() - t0) / 1000 < 5);
});
