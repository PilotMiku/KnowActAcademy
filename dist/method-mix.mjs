import { getBankIndex, isScorable, shuffle } from './core.mjs';
import { questionActivity, rootChapter } from './study-planning.mjs';
import { questionSkill } from './question-skills.mjs';
import { questionGuidance } from './question-guidance.mjs';
import { sectionKnowledgeCard } from './section-knowledge.mjs';
import { attr, esc } from './ui.mjs';

export const METHOD_MIX_MODE = 'method-mix';
export const METHOD_MIX_TITLE = '易混题型混练';
export const METHOD_MIX_TOPIC = '换元积分与分部积分';

const methods = [
  {
    name: '换元积分', chapterId: 's-6dbdf44fd58a',
    clues: {
      4: String.raw`余弦是奇次幂。留出一个 \(\cos x\,dx\) 作为 \(d(\sin x)\)，其余的 \(\cos^4 x\) 可写成 \((1-\sin^2 x)^2\)，令 \(u=\sin x\) 后全部化为关于 \(u\) 的多项式。`,
      8: String.raw`把 \(\ln x\) 看作一个整体，恰有 \(d(\ln x)=dx/x\)。令 \(u=\ln x\)，原式立即变成 \(\int u^2\,du\)。`,
      10: String.raw`分母的导数是 \((a^2-b^2)\sin 2x\)，与分子只差常数因子。把分母整体设为 \(u\)，就得到常数倍的 \(\int du/u\)。`,
      14: String.raw`令 \(u=\arctan\sqrt{x}\)，则 \(du=\frac{dx}{2\sqrt{x}(1+x)}\)。分母正好提供这个微分所需的因子，原式变成 \(2\int u\,du\)。`,
      17: String.raw`\(\sin x\) 的导数 \(\cos x\) 正好是旁边的因子。令 \(u=\sin x\)，把看似两个函数相乘的积分化为 \(\int u^2\,du\)。`,
      19: String.raw`分子 \(1+\ln x\) 正好是分母 \(1+x\ln x\) 的导数。以分母为 \(u\)，便可直接计算 \(\int du/u\)。`,
      20: String.raw`令 \(u=1+2\ln x\)，则 \(du=2\,dx/x\)。分母中的 \(x\) 提供了 \(dx/x\)，所以换元后只剩 \(\tfrac12\int du/u\)。`,
      23: String.raw`指数里的 \(x^2\) 求导得到 \(2x\)，与外面的 \(x\) 只差常数因子。令 \(u=x^2\)，原式变成 \(\tfrac12\int e^u\,du\)。`,
    },
  },
  {
    name: '分部积分', chapterId: 's-9ec99f1bbaaa',
    clues: {
      1: String.raw`取 \(u=x^2,\ dv=\cos x\,dx\)。余弦容易积分，多项式每求导一次就降一阶，做两次分部积分就能消去多项式因子。`,
      2: String.raw`把 \(\ln x\) 看作 \(1\cdot\ln x\)。取 \(u=\ln x,\ dv=dx\)，得到 \(v\,du=x\cdot dx/x=dx\)，剩余的积分立即简化。`,
      3: String.raw`取 \(u=\sin x,\ dv=e^x\,dx\)。指数积分后形式相同，正弦与余弦求导会互相转换。做两次分部积分后原积分重新出现，可以移项求出。`,
      4: String.raw`取 \(u=\ln x,\ dv=x^2\,dx\)。对数求导变成 \(1/x\)，与 \(v=x^3/3\) 相乘后只剩一个简单的幂函数。`,
      5: String.raw`取 \(u=x,\ dv=\cos x\,dx\)。这里余弦的自变量是 \(x\)，而线性因子 \(x\) 一求导就变为 1，分部积分后只剩 \(\int\sin x\,dx\)。`,
      8: String.raw`取 \(u=\ln^2 x,\ dv=x^{-2}\,dx\)。求导把对数的次数从 2 降到 1，所得积分保留 \(x^{-2}\) 因子，再做一次分部积分即可继续降次。`,
      10: String.raw`指数 \(e^x\) 积分后仍是 \(e^x\)。取 \(u=x^2,\ dv=e^x\,dx\)，让多项式因子通过两次求导从二次降到常数。`,
      15: String.raw`指数的自变量是 \(x\)，外面的 \(x\) 是独立的线性因子。取 \(u=x,\ dv=e^x\,dx\)，一次分部积分就把剩余项化为 \(\int e^x\,dx\)。`,
    },
  },
];

const entries = methods.map(({ name, chapterId, clues }) => Object.entries(clues).map(([number, clue]) => ({
  id: `${chapterId}-q${number.padStart(4, '0')}`, chapterId, name, clue,
})));
const byId = new Map(entries.flat().map(entry => [entry.id, entry]));

function methodPools(bank) {
  if (bank.managedBundle === false) return [[], []];
  const { questions } = getBankIndex(bank);
  return entries.map(method => method.map(({ id }) => questions.get(id)).filter(q =>
    q?.subjectId === 'calculus' && q.chapterId === byId.get(q.id).chapterId && q.type === 'single' && isScorable(q)));
}

const perMethod = pools => Math.min(4, ...pools.map(pool => pool.length));

export function methodMixCount(bank) {
  return perMethod(methodPools(bank)) * methods.length;
}

export function methodMixRound(bank, state, random = Math.random) {
  const pools = methodPools(bank);
  const count = perMethod(pools);
  const activity = questionActivity(pools.flat(), state);
  const lastDone = q => activity.get(q.id)?.lastAt ?? 0;
  const selected = pools.map(pool => shuffle(pool, random).sort((a, b) => lastDone(a) - lastDone(b)).slice(0, count));
  return Array.from({ length: count }, (_, i) => shuffle(selected.map(pool => pool[i].id), random)).flat();
}

export function chapterMethodMixes(bank, questions, annotations) {
  const index = getBankIndex(bank), chapters = new Map();
  for (const q of questions) {
    if (!isScorable(q)) continue;
    const id = rootChapter(bank, q);
    const [, chapterId] = JSON.parse(id);
    const root = index.chapters.get(q.subjectId)?.get(chapterId);
    const section = index.chapters.get(q.subjectId)?.get(q.chapterId);
    const skill = questionSkill(q, annotations);
    if (!skill && (!section || section.id === chapterId)) continue;
    const groupKey = skill ? 'skill:' + skill : 'section:' + section.id;
    if (!chapters.has(id)) chapters.set(id, {
      id, name: [index.subjects.get(q.subjectId)?.name, root?.name ?? section?.name].filter(Boolean).join(' · '),
      groups: new Map(),
    });
    const groups = chapters.get(id).groups;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(q);
  }
  return bank.subjects.flatMap(subject => subject.chapters.map(chapter => chapters.get(JSON.stringify([subject.id, chapter.id]))))
    .filter(chapter => chapter?.groups.size >= 2);
}

export function chapterMethodMixRound(chapter, state, random = Math.random) {
  const groups = [...chapter.groups.values()];
  const activity = questionActivity(groups.flat(), state);
  const lastDone = q => activity.get(q.id)?.lastAt ?? 0;
  const queues = shuffle(groups, random).map(group => shuffle(group, random).sort((a, b) => lastDone(b) - lastDone(a)));
  queues.sort((a, b) => lastDone(a.at(-1)) - lastDone(b.at(-1)));
  const selected = [];
  while (selected.length < 8) {
    const active = queues.filter(queue => queue.length);
    if (active.length < 2) break;
    const width = Math.min(active.length, selected.length ? 4 : 8, 8 - selected.length);
    if (width < 2) break;
    selected.push(...shuffle(active.slice(0, width), random).map(queue => queue.pop().id));
  }
  return selected;
}

export function methodMixFeedback(question, bank, annotations) {
  const entry = bank?.managedBundle === false ? null : byId.get(question.id);
  const card = sectionKnowledgeCard(question.subjectId, question.chapterId);
  const section = bank && getBankIndex(bank).chapters.get(question.subjectId)?.get(question.chapterId);
  const knowledge = section?.name === card?.sourceTitle && section?.parentId === card?.chapterId ? card : null;
  const skill = questionSkill(question, annotations);
  const guide = questionGuidance(question, annotations);
  const title = entry ? '选法依据 · ' + entry.name : guide.method && skill ? '选法依据 · ' + skill
    : skill ? '本题考点 · ' + skill : section ? '所属小节 · ' + section.name : '';
  const clue = entry?.clue || guide.method || knowledge?.condition || knowledge?.overview;
  if (!title) return '';
  const sectionNote = !entry && !guide.method && clue ? '<p class="muted">小节知识卡要点</p>' : '';
  return `<div class="analysis method-mix-feedback"><b>${esc(title)}</b>${clue ? sectionNote + `<div class="rich" data-rich="${attr(clue)}"></div>` : ''}</div>`;
}
