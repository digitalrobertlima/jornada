// Ajustes: perfil, casa, cotações, backup (soberania de dados) e modo demonstração.

import { store } from '../store.js';
import { vault, Vault } from '../db/vault.js';
import { esc, openSheet, toast, confirmSheet, formData } from './dom.js';
import { icon } from './icons.js';
import { brl, dateBR, parseMoney } from '../core/format.js';
import { buildDemoScenario } from '../db/demoScenario.js';
import { normalizeHousehold } from '../core/model.js';
import { openProfileWizard } from './wizards.js';
import { cloudSectionHTML, bindCloudSection } from './cloud.js';

export const APP_VERSION = '1.6.0';

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportBackup() {
  const text = await vault.exportBackup({ market: store.meta.market, manual: store.meta.manual });
  download(`jornada-backup-${store.today}.json`, text);
  await store.setMeta('lastBackup', new Date().toISOString());
  toast('Backup salvo. Guarde o arquivo num lugar seguro (e-mail para você mesmo, pen drive, nuvem).', { tone: 'cyan', timeout: 5200 });
}

/** Abre a folha de compartilhamento do celular com o arquivo; a pessoa escolhe "Drive" e salva na própria conta, sem login nem permissão. */
export async function shareToDrive() {
  const text = await vault.exportBackup({ market: store.meta.market, manual: store.meta.manual });
  const name = `jornada-backup-${store.today}.json`;
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup do Jornada' });
      await store.setMeta('lastBackup', new Date().toISOString());
      toast('Se você escolheu o Drive, seu backup está salvo lá.', { tone: 'cyan', timeout: 5200 });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // a pessoa fechou a folha
  }
  // Computador / navegador sem compartilhamento de arquivos: baixa e abre o Drive para arrastar.
  download(name, text);
  await store.setMeta('lastBackup', new Date().toISOString());
  window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener');
  toast('Arquivo baixado. No Drive que abriu, é só arrastar o arquivo para lá.', { tone: 'cyan', timeout: 7000 });
}

export function importBackup(onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { state, settings } = Vault.parseBackup(await file.text());
      const ok = await confirmSheet({
        title: 'Restaurar backup?',
        text: `${state.profiles.length} perfil(is), ${state.obligations.length} conta(s)/dívida(s), ${state.ledger.length} lançamento(s). <b>Substitui tudo</b> o que está neste aparelho.`,
        confirmLabel: 'Restaurar',
        danger: true,
      });
      if (!ok) return;
      await store.replaceAll(state, {
        activeProfileId: state.profiles[0].id, demo: false, manual: settings.manual || {}, market: settings.market || store.meta.market,
      });
      toast('Backup restaurado.', { tone: 'cyan' });
      onDone?.();
    } catch (err) {
      toast(esc(err.message), { tone: 'magenta' });
    }
  };
  input.click();
}

export async function loadDemo(onDone) {
  const hasData = store.state.profiles.length > 0 && !store.meta.demo;
  if (hasData) {
    const ok = await confirmSheet({ title: 'Carregar cenário de teste?', text: 'Isso <b>substitui</b> seus dados deste aparelho. Faça um backup antes se quiser guardar.', confirmLabel: 'Substituir', danger: true });
    if (!ok) return;
  }
  await store.replaceAll(buildDemoScenario(store.today), { activeProfileId: 'prof_01', demo: true });
  toast('Cenário Realista de Teste carregado.', { tone: 'cyan', iconName: 'spark' });
  onDone?.();
}

export async function clearAll(onDone) {
  const ok = await confirmSheet({
    title: store.meta.demo ? 'Sair do modo demonstração?' : 'Apagar tudo?',
    text: store.meta.demo ? 'Apaga os dados fictícios e volta para o início.' : 'Apaga <b>todos</b> os perfis, contas e lançamentos deste aparelho. Não tem volta sem backup.',
    confirmLabel: 'Apagar tudo',
    danger: true,
  });
  if (!ok) return;
  await store.clearAll();
  toast('Tudo limpo.');
  onDone?.();
}

export function openSettings({ onReload, refreshMarket }) {
  const p = store.profile;
  const m = store.meta;
  const last = m.lastBackup ? dateBR(m.lastBackup.slice(0, 10)) : 'nunca';
  openSheet({
    title: 'Ajustes & dados',
    body: `<div class="stack">
      ${cloudSectionHTML()}
      <section class="card tight">
        <div class="row between"><span class="eyebrow">Perfil ativo</span><button class="btn sm ghost" data-s="profile">${icon('edit')}Editar</button></div>
        <div style="margin-top:6px"><b>${esc(p?.name || '—')}</b> · renda ${brl(p?.monthlyNetIncome)} · ${p?.monthlyWorkAndCommuteHours || 0} h/mês</div>
        <div class="tiny">Hora de vida real: ${brl(p?.realHourlyRate)} · micro-escudo ${brl(p?.shieldTarget)}</div>
        <button class="btn sm" style="margin-top:10px" data-s="profile-new">${icon('person')}Adicionar perfil (Modo Casa)</button>
      </section>

      <section class="card tight">
        <form id="house" class="row" novalidate>
          <label class="field grow"><span>Nome da casa</span><input class="input" name="name" value="${esc(store.state.household?.name || 'Minha Casa')}" maxlength="40"></label>
          <button class="btn sm" type="submit" style="align-self:flex-end">Salvar</button>
        </form>
      </section>

      <section class="card tight">
        <span class="eyebrow">Cotações (BTC e CDI)</span>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="live"${m.liveMarket !== false ? ' checked' : ''}><span>Buscar cotações ao vivo<br><small class="tiny">Só o pedido da cotação sai do aparelho. Nenhum dado seu.</small></span></label>
        <form id="manual" class="stack" style="margin-top:10px" novalidate>
          <div class="grid-2">
            <label class="field"><span>BTC manual (R$)</span><input class="input" name="btc" inputmode="decimal" placeholder="auto" value="${m.manual?.btc ? String(m.manual.btc).replace('.', ',') : ''}"></label>
            <label class="field"><span>CDI manual (% a.a.)</span><input class="input" name="cdi" inputmode="decimal" placeholder="auto" value="${m.manual?.cdi ? String(m.manual.cdi).replace('.', ',') : ''}"></label>
          </div>
          <div class="row"><button class="btn sm" type="submit">Salvar manual</button><button class="btn sm ghost" type="button" data-s="refresh">${icon('refresh')}Buscar agora</button></div>
          <small class="tiny">Deixe em branco para usar a cotação ao vivo.</small>
        </form>
      </section>

      <section class="card tight">
        <span class="eyebrow">Últimas ações</span>
        <p class="tiny" style="margin:4px 0 8px">Desfazer volta tudo o que foi feito junto: saldos, dívidas, parcelas e horas.</p>
        ${(m.journal || []).slice(0, 8).map((a) => `<div class="row between small" style="padding:6px 0;border-top:1px solid var(--border)">
          <span class="grow">${esc(a.label)}<br><span class="tiny">${new Date(a.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
          <button class="btn sm ghost" type="button" data-undo="${esc(a.id)}">Desfazer</button></div>`).join('') || '<div class="tiny">Nenhuma ação ainda.</div>'}
      </section>

      <section class="card tight">
        <span class="eyebrow">Seus dados</span>
        <p class="small" style="margin:6px 0 10px">Tudo fica só neste aparelho. Se trocar de celular ou limpar o navegador, só o backup salva seus dados. Último backup: <b>${last}</b>.<br>Para guardar no Google Drive não precisa de login: toque em <b>Salvar no Google Drive</b> e escolha o Drive.</p>
        <div class="grid-2">
          <button class="btn sm primary" data-s="drive">${icon('cloud')}Salvar no Google Drive</button>
          <button class="btn sm" data-s="export">${icon('download')}Exportar backup</button>
          <button class="btn sm" data-s="import">${icon('upload')}Importar backup</button>
        </div>
      </section>

      <section class="card tight">
        <span class="eyebrow">Demonstração</span>
        <div class="grid-2" style="margin-top:10px">
          <button class="btn sm" data-s="demo">${icon('spark')}Cenário de teste</button>
          <button class="btn sm danger" data-s="clear">${icon('trash')}Apagar tudo</button>
        </div>
      </section>

      <p class="tiny" style="text-align:center">Jornada v${APP_VERSION} · local-first · sem servidor · código aberto</p>
    </div>`,
    onMount(el, close) {
      const on = (k, fn) => el.querySelector(`[data-s="${k}"]`)?.addEventListener('click', fn);
      bindCloudSection(el, close);
      el.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
        await store.undo(b.dataset.undo);
        close();
        toast('Desfeito. Tudo voltou ao que era.', { tone: 'cyan' });
      }));
      on('profile', () => { close(); openProfileWizard(store.pid); });
      on('profile-new', () => { close(); openProfileWizard(); });
      on('drive', () => shareToDrive());
      on('export', () => exportBackup());
      on('import', () => { close(); importBackup(onReload); });
      on('demo', () => { close(); loadDemo(onReload); });
      on('clear', () => { close(); clearAll(onReload); });
      on('refresh', async () => { await refreshMarket(true); toast('Cotações atualizadas.'); });
      el.querySelector('#house').onsubmit = async (e) => {
        e.preventDefault();
        await store.commit({ household: [normalizeHousehold({ ...store.state.household, name: e.target.name.value.trim() || 'Minha Casa' })] }, { label: 'Renomeou a casa' });
        toast('Casa renomeada.');
      };
      el.querySelector('[name=live]').onchange = async (e) => {
        await store.setMeta('liveMarket', e.target.checked);
        if (e.target.checked) refreshMarket(true);
      };
      el.querySelector('#manual').onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(e.target);
        await store.setMeta('manual', { btc: parseMoney(v.btc) || null, cdi: parseMoney(v.cdi) || null }, { render: true });
        toast('Valores manuais salvos.');
      };
    },
  });
}
