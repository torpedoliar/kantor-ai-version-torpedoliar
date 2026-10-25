// Pure roster logic: no fs, no http. server.js owns all I/O.
const ASK_QUESTIONS = [
  'If the brief is missing information you cannot draft well without (for example the product, the audience or the key facts),',
  'do not guess: reply with the line QUESTIONS: followed by at most three short numbered questions, and nothing else.',
  'Otherwise never start your answer with QUESTIONS:.'
].join(' ');

const GROUPS = new Set(['leadership', 'marketing', 'engineering', 'service']);
const GENDERS = new Set(['male', 'female']);

function defaultSystem(role, isManager) {
  const base = [
    `You are the ${role} on a team working in a virtual office called Kantor Kita.`,
    'You receive tasks from teammates and return drafts that a human will review before anything is published.',
    'Write in the language of the task (Indonesian or English). If the task mixes both, follow the brief.',
  ];
  if (isManager) base.push(
    'You also lead your direct reports: when a task is too big, say so in one line and list the subtasks you would delegate.',
    'When you review a draft from your team, check facts first, then tone, then completeness.',
  );
  else base.push(
    'Structure your answer as: a short summary line, then the draft, then any notes or questions for the reviewer.',
    'Your draft goes to your manager first; write so your manager can approve it in one read.',
  );
  base.push(
    'Never claim that you posted, scheduled or sent anything. Never invent facts about the company, products, prices or people; if something is missing, list it under notes as a question.',
    'Keep the whole answer under 600 words.',
    ASK_QUESTIONS
  );
  return base.join('\n');
}

const SEED = [
  {manager: null, n: 'Koh Arman', initials: 'KA', gender: 'male', role: 'CEO', group: 'leadership', ai: null},
  {manager: 'Koh Arman', n: 'Koh Wira', initials: 'KW', gender: 'male', role: 'CTO', group: 'leadership', ai: null},
  {manager: 'Kak Dewi', n: 'Kak Rani', initials: 'KR', gender: 'female', role: 'Social Media Specialist', group: 'marketing', ai: {on: true, model: 'TH/qwen3.8-flash:free', system: [
    'You are the Social Media Specialist on a 13-person team working in a virtual office called Kantor Kita.',
    'You receive tasks from teammates and return drafts that a human will review before anything is published.',
    'Write in the language of the task (Indonesian or English). If the task mixes both, follow the brief.',
    'Structure your answer as: a short summary line, then two or three caption options with suggested hashtags, then any notes or questions for the reviewer.',
    'Never claim that you posted, scheduled or sent anything. Never invent facts about the company, products, prices or people; if something is missing, list it under notes as a question.',
    'Keep the whole answer under 600 words.',
    ASK_QUESTIONS
  ].join('\n')}},
  {manager: 'Koh Arman', n: 'Kak Dewi', initials: 'KD', gender: 'female', role: 'Digital Marketing', group: 'marketing', ai: null},
  {manager: 'Kak Dewi', n: 'Mira', initials: 'M', gender: 'female', role: 'Business Development', group: 'marketing', ai: null},
  {manager: 'Kak Dewi', n: 'Tari', initials: 'T', gender: 'female', role: 'Social Media Intern', group: 'marketing', ai: null},
  {manager: 'Koh Wira', n: 'Bagas Pratama Putra', initials: 'BPP', gender: 'male', role: 'Frontend Engineer', group: 'engineering', ai: null},
  {manager: 'Koh Wira', n: 'Rizky Hakim', initials: 'RH', gender: 'male', role: 'Backend Engineer', group: 'engineering', ai: null},
  {manager: 'Koh Wira', n: 'Yoga', initials: 'Y', gender: 'male', role: 'Product Design', group: 'engineering', ai: null},
  {manager: 'Koh Wira', n: 'Bang Eko', initials: 'BE', gender: 'male', role: 'Graphic Designer', group: 'engineering', ai: null},
  {manager: 'Koh Arman', n: 'Gilang', initials: 'G', gender: 'male', role: 'Customer Service Leader', group: 'service', ai: null},
  {manager: 'Gilang', n: 'Kak Sinta', initials: 'KS', gender: 'female', role: 'Customer Service', group: 'service', ai: {on: true, model: 'TH/deepseek-v4-flash:free', system: [
    'You are a Customer Service agent on a 13-person team working in a virtual office called Kantor Kita.',
    'You draft replies to customer messages. A human reviews every reply before it is sent.',
    'Reply in the customer\'s language. Be warm, short and concrete: acknowledge the issue, give the next step, and close politely.',
    'Never promise refunds, discounts, delivery dates or anything else the brief does not confirm. Never claim that you sent the reply.',
    'Structure your answer as: the reply draft, then a short note for the reviewer if anything should be checked.',
    'Keep the whole answer under 250 words.',
    ASK_QUESTIONS
  ].join('\n')}},
  {manager: 'Gilang', n: 'Kak Laras', initials: 'KL', gender: 'female', role: 'Customer Service', group: 'service', ai: null}
];

// isNew=true (POST): all fields required. false (PATCH): only present fields validated.
// _self = old name on PATCH, so renaming to the same name passes the clash check.
// Failure returns {ok:false, error, code} where code 'dup' means 409, else 400.
function validateMember(input, team, isNew) {
  if (!input || typeof input !== 'object') return {ok: false, error: 'Expected an object.', code: 'bad'};
  const get = k => input[k] === undefined ? undefined : String(input[k]).trim();
  const out = {};
  const need = (k, max) => {
    const v = get(k);
    if (v === undefined) return isNew ? {ok: false, error: `Pick a ${k}.`, code: 'bad'} : null;
    if (!v || v.length > max) return {ok: false, error: `${k} must be 1-${max} characters.`, code: 'bad'};
    out[k] = v; return null;
  };
  for (const [k, max] of [['n', 80], ['initials', 4], ['role', 80]]) {
    const err = need(k, max);
    if (err) return err;
  }
  if (input.gender !== undefined || isNew) {
    if (!GENDERS.has(get('gender') ?? '')) return {ok: false, error: 'Pick male or female.', code: 'bad'};
    out.gender = get('gender');
  }
  if (input.group !== undefined || isNew) {
    if (!GROUPS.has(get('group') ?? '')) return {ok: false, error: 'Pick a desk group.', code: 'bad'};
    out.group = get('group');
  }
  if (input.ai !== undefined) {
    if (input.ai !== null) {
      if (typeof input.ai !== 'object') return {ok: false, error: 'Bad AI config.', code: 'bad'};
      const model = String(input.ai.model || '').trim().slice(0, 200);
      const system = String(input.ai.system ?? '').trim().slice(0, 5000);
      if (!model) return {ok: false, error: 'Pick a model from the router list.', code: 'bad'};
      out.ai = {on: input.ai.on !== false, model, system: system || defaultSystem(out.role || 'Team member')};
      // ponytail: empty system = generic role-based template, not an error
    } else out.ai = null;
  }
  const clash = team.find(m => m.n.toLowerCase() === (out.n ?? '').toLowerCase() && m.n !== input._self);
  if (out.n && clash) return {ok: false, error: 'That name is already used.', code: 'dup'};
  const clashInit = team.find(m => m.initials.toLowerCase() === (out.initials ?? '').toLowerCase() && m.n !== input._self);
  if (out.initials && clashInit) return {ok: false, error: 'Those initials are already used.', code: 'dup'};
  return {ok: true, member: out};
}

function managerChain(roster, name) {
  const byName = new Map(roster.map(m => [m.n, m]));
  const chain = [];
  const seen = new Set([name]);
  let cur = byName.get(name)?.manager ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.push(cur);
    cur = byName.get(cur)?.manager ?? null;
  }
  return chain;
}

function isManagerOf(roster, actor, target) {
  if (actor === target) return false;
  const actorRec = roster.find(m => m.n === actor);
  if (!actorRec) return false;
  if (actorRec.manager == null) return true; // owner kuasa atas semua
  return managerChain(roster, target).includes(actor);
}

function validateManagerAssignment(roster, selfName, managerName) {
  if (managerName === null || managerName === undefined || managerName === '') return {ok: true, manager: null};
  const m = String(managerName).trim();
  if (!roster.some(x => x.n === m)) return {ok: false, error: 'Unknown manager.', code: 'bad'};
  if (m === selfName) return {ok: false, error: 'A member cannot manage themselves.', code: 'bad'};
  if (managerChain(roster, m).includes(selfName)) return {ok: false, error: 'That would create a management cycle.', code: 'dup'};
  return {ok: true, manager: m};
}

function cascadeRename(tasks, oldName, newName) {
  for (const t of tasks) if (t.assignee === oldName) t.assignee = newName;
}

function cascadeRenameMember(roster, tasks, oldName, newName) {
  for (const m of roster) if (m.manager === oldName) m.manager = newName;
  cascadeRename(tasks, oldName, newName);
}

function reassignSubordinates(roster, deletedName, fallback) {
  let count = 0;
  for (const m of roster) {
    if (m.manager === deletedName) { m.manager = fallback ?? null; count++; }
  }
  return {count};
}

module.exports = {SEED, GROUPS: [...GROUPS], validateMember, cascadeRename, cascadeRenameMember, reassignTasks, reassignSubordinates, managerChain, isManagerOf, validateManagerAssignment, defaultSystem, ASK_QUESTIONS};

function reassignTasks(tasks, from, to) {
  let moved = 0;
  for (const t of tasks) {
    if (t.assignee !== from || t.status === 'done') continue;
    t.assignee = to;
    if (t.status === 'active') { t.status = 'queued'; t.runId = null; }
    t.version = (t.version || 0) + 1; t.updatedAt = new Date().toISOString(); t.error = undefined;
    moved++;
  }
  return {moved};
}
