export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const shotLink = name => /^[a-zA-Z0-9_-]{1,80}\.png$/.test(String(name || '')) ? `<a href="screenshots/${name}">Скриншот</a>` : '—';

export function renderHtml(report) {
  const sum = report.summary;
  const issues = report.issues.map(i => `<tr><td><b>${esc(i.title)}</b><small>${esc(i.kind)} · ${esc(i.severity)} · ${esc(i.status)}</small></td><td>${esc(i.scenario)} / ${esc(i.viewport)}</td><td>${esc(i.description)}</td><td>${shotLink(i.screenshot)}</td></tr>`).join('');
  const traceLink = name => /^traces\/trace-[1-9]\d*-[1-9]\d*\.zip$/.test(String(name || '')) ? ` · <a href="${name}">Trace ZIP</a>` : '';
  const flows = report.results.map(r => `<tr><td>${esc(r.scenario)}</td><td>${esc(r.viewport)}</td><td>${esc(r.passedSteps)}/${esc(r.totalSteps)}</td><td>${esc(r.status)}</td><td>${shotLink(r.screenshot)}${traceLink(r.trace)}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>UXProof — ${esc(report.project)}</title><style>
  body{font:15px/1.6 system-ui;background:#f6f7f9;color:#18212e;max-width:1150px;padding:34px;margin:auto}h1{font-size:32px;margin-bottom:0}h2{margin-top:40px}small{display:block;color:#667485}table{border-collapse:collapse;width:100%;background:#fff}td,th{border-bottom:1px solid #e4e8ee;padding:12px;text-align:left;vertical-align:top}th{background:#eef1f4}p{color:#5a6675}.pill{display:inline-block;padding:7px 12px;border:1px solid #d7dde4;border-radius:8px;background:#fff;margin:6px 8px 6px 0}</style></head><body>
  <h1>UXProof / ${esc(report.project)}</h1><p>${esc(report.baseUrl)} · ${esc(report.startedAt)} · ${esc(report.runId)}</p>
  <div class="pill">Пройдено: ${sum.passedRuns}/${sum.totalRuns}</div><div class="pill">Проверенные дефекты: ${sum.confirmedIssues}</div><div class="pill">Рекомендации ИИ: ${sum.aiSuggestions}</div><div class="pill">Гипотезы правил: ${esc(sum.ruleSuggestions ?? 0)}</div>
  <h2>Сценарии</h2><table><thead><tr><th>Сценарий</th><th>Экран</th><th>Шаги</th><th>Итог</th><th>Доказательство</th></tr></thead><tbody>${flows}</tbody></table>
  <h2>Найденные проблемы и рекомендации</h2><table><thead><tr><th>Проблема</th><th>Контекст</th><th>Описание</th><th>Файл</th></tr></thead><tbody>${issues || '<tr><td colspan="4">Нет обнаруженных проблем</td></tr>'}</tbody></table>
  <p>Подтверждено — ошибка воспроизведена автоматической проверкой. Рекомендации модели и гипотезы правил требуют проверки человеком. Отсутствие предупреждений axe-core не означает полное соответствие WCAG.</p></body></html>`;
}
