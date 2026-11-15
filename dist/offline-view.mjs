import { esc,attr,button,head } from './ui.mjs';
export const formatBytes = bytes => bytes >= 1024 * 1024 ? (bytes/1024/1024).toFixed(1) + ' MB'
  : bytes >= 1024 ? (bytes/1024).toFixed(1) + ' KB' : Math.max(0, Math.round(bytes)) + ' B';
export function offlineProgressDisplay(progress) {
  const done = Math.max(0, Number(progress?.done) || 0), total = Math.max(0, Number(progress?.total) || 0);
  const percent = total ? Math.min(100, done / total * 100) : 0;
  return { percent, label:progress ? `已处理 ${formatBytes(done)} / ${formatBytes(total)} · ${Math.floor(percent)}%` : '正在准备离线资源…' };
}
export function offlinePage(manager, bank) {
  const state=manager.state, data=state.manifest, disabled=state.busy?'disabled':'';
  const subjectId = state.selectedSubject ?? bank.subjects[0]?.id;
  const compatible = data && bank.managedBundle !== false && data.bankRevision === bank.revision;
  const progress = offlineProgressDisplay(state.progress);
  return `${head('离线题库','手动下载章节及公式图片，在没有网络时继续练习。','<a class="btn" href="#/practice">章节练习</a>')}
    <section class="card offline-overview"><h2>${navigator.onLine?'离线下载与版本管理':'当前处于离线状态'}</h2><p>${data ? `题库版本 ${esc(data.bankRevision)} · 离线版本 ${esc(data.version.slice(0,12))}` : '正在准备离线服务…'}</p><p id="offline-status" role="status">${esc(state.error || state.message)}</p><div id="offline-progress" ${state.busy?'':'hidden'}><label id="offline-progress-label">${esc(progress.label)}</label><progress max="100" value="${progress.percent}" aria-labelledby="offline-progress-label"></progress></div><div class="flex">${button(state.ready?'检查内容更新':'重新连接离线服务','offline-check',disabled,'btn')}${state.update?button('下载更新并刷新','offline-update',disabled,'btn primary'):''}${button('清理旧版本','offline-clean',`${disabled} ${state.ready?'':'disabled'}`,'btn')}</div><p class="format-note">首次下载包含约 ${data?formatBytes(data.shellBytes):'…'} 的公共页面与字体。章节之间会共享公式资源；移除离线包不会删除学习记录。完整题库备份仍需联网，轻量进度备份可离线导出。</p></section>
    ${data?`<section class="card offline-download"><h2>选择下载范围</h2>${!compatible?'<p class="notice">离线包对应内置题库；请切回对应版本的内置题库后再练习。</p>':''}<label class="field">科目<select id="offline-subject">${bank.subjects.map(s=>`<option value="${attr(s.id)}" ${s.id===subjectId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label class="field">章节<select id="offline-chapter">${data.chapters.filter(c=>c.subjectId===subjectId).map(c=>`<option value="${attr(c.id)}" ${c.id===state.selectedChapter?'selected':''}>${c.parentId?'　↳ ':''}${esc(c.name)} · ${c.questions} 题 · ${formatBytes(c.bytes)}</option>`).join('')}</select></label>${button('下载所选章节','offline-download',`${disabled} ${compatible?'':'disabled'}`,'btn primary')}</section>`:''}
    <div class="section-head"><h2>已下载章节 <small>${state.packages.length} 个</small></h2></div><div class="offline-packages">${state.packages.map(row=>`<article class="card offline-package"><h3>${esc(row.subjectName)} · ${esc(row.name)}</h3><p>${row.questions} 题 · 章节资源 ${formatBytes(row.bytes)} · ${row.version===state.version?'当前版本':'旧版本，请下载更新'}</p><div class="flex">${compatible&&row.version===state.version?`<a class="btn small" href="#/practice?subject=${encodeURIComponent(row.subjectId)}&chapter=${encodeURIComponent(row.chapterId)}">练习此章节</a>`:''}${button('移除下载','offline-remove',`data-id="${attr(row.id)}" ${disabled}`,'btn small')}</div></article>`).join('')||'<section class="card offline-overview"><p>尚未下载章节，选择一个小节即可开始。</p></section>'}</div>`;
}
