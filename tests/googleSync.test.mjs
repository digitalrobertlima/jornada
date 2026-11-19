import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSync } from '../js/services/googleSync.js';

test('sincronização: decisões seguras', () => {
  assert.equal(decideSync({ localEmpty: false, localAt: 10, remoteAt: null, lastSyncAt: null }), 'push');   // 1º login, nada no Drive
  assert.equal(decideSync({ localEmpty: true, localAt: 0, remoteAt: 5, lastSyncAt: null }), 'pull');       // celular novo
  assert.equal(decideSync({ localEmpty: false, localAt: 10, remoteAt: 5, lastSyncAt: null }), 'ask');      // dados nos dois, nunca sincronizou
  assert.equal(decideSync({ localEmpty: false, localAt: 9000, remoteAt: 5000, lastSyncAt: 5000 }), 'push'); // só o aparelho mudou
  assert.equal(decideSync({ localEmpty: false, localAt: 5000, remoteAt: 9000, lastSyncAt: 5000 }), 'pull'); // só o Drive mudou (outro aparelho)
  assert.equal(decideSync({ localEmpty: false, localAt: 9000, remoteAt: 9500, lastSyncAt: 5000 }), 'ask');  // os dois mudaram
  assert.equal(decideSync({ localEmpty: false, localAt: 5000, remoteAt: 5000, lastSyncAt: 5000 }), 'none');
});
