// Turns a raw normalised job into an enriched one: role type, years of experience,
// fresh-grad tier, tech stack and flags. Pure functions, no I/O.

export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html, { escaped = false } = {}) {
  if (!html) return '';
  let s = String(html);
  if (escaped) s = decodeEntities(s);
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- tech catalog ----------
// Order matters only for display. Each regex is tested against title + description.
export const TECH = [
  ['Go', /(?:^|[\s,(\/&])Go(?:lang)?(?![\w-])(?!\s+(?:to|above|beyond|live|the|further|forward|through|from|for|back|into|ahead))|\bgolang\b/],
  ['Python', /\bpython\b/i],
  ['TypeScript', /\btype\s?script\b/i],
  ['JavaScript', /\bjava\s?script\b|\bES6\b/i],
  ['Java', /\bjava\b(?!\s?script)/i],
  ['C++', /\bC\+\+|\bcpp\b/i],
  ['C#', /\bC#|\.NET\b/i],
  ['Rust', /\brust\b/i],
  ['Kotlin', /\bkotlin\b/i],
  ['Swift', /\bswift(?:ui)?\b/i],
  ['PHP', /\bphp\b/i],
  ['Ruby', /\bruby\b|\brails\b/i],
  ['SQL', /\bsql\b/i],
  ['React', /\breact(?:\.?js)?\b(?!\s?native)/i],
  ['Next.js', /\bnext\.?js\b/i],
  ['Vue', /\bvue(?:\.?js)?\b/i],
  ['Angular', /\bangular\b/i],
  ['Tailwind', /\btailwind\b/i],
  ['HTML/CSS', /\bhtml5?\b|\bcss3?\b/i],
  ['Node.js', /\bnode(?:\.?js)?\b/i],
  ['Spring', /\bspring(?:\s?boot)?\b/i],
  ['Django', /\bdjango\b|\bflask\b|\bfastapi\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['REST', /\brest(?:ful)?\b(?!\s?(?:of|time))/i],
  ['gRPC', /\bgrpc\b|\bthrift\b|\bprotobuf\b|\bkitex\b/i],
  ['Microservices', /\bmicro-?services?\b/i],
  ['MySQL', /\bmysql\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['MongoDB', /\bmongo(?:db)?\b/i],
  ['Redis', /\bredis\b/i],
  ['Kafka', /\bkafka\b/i],
  ['Hive/Spark', /\bhive\b|\bspark\b|\bhadoop\b/i],
  ['Firebase', /\bfirebase\b|\bfirestore\b/i],
  ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['AWS', /\baws\b|\bamazon web services\b/i],
  ['GCP', /\bgcp\b|\bgoogle cloud\b/i],
  ['Azure', /\bazure\b/i],
  ['Linux', /\blinux\b/i],
  ['CI/CD', /\bci\s?\/\s?cd\b|\bjenkins\b|\bgithub actions\b/i],
  ['LLM', /\bLLMs?\b|large language model|\bgenerative ai\b|\bgenai\b|\bgpt-?\d?\b/i],
  ['AI Agents', /\bai agents?\b|\bagentic\b|\bmulti-?agent\b|\bagent frameworks?\b|\bagents? (?:system|platform|workflow)s?\b/i],
  ['RAG', /\bRAG\b|retrieval[- ]augmented/],
  ['LangChain', /\blang(?:chain|graph)\b|\bllamaindex\b/i],
  ['Prompt Eng.', /\bprompt(?:ing)? engineering\b|\bprompts?\b/i],
  ['MCP', /\bMCP\b|model context protocol/],
  ['Vector DB', /\bvector (?:db|database|store|search)s?\b|\bpinecone\b|\bpgvector\b|\bembeddings?\b/i],
  ['OpenAI/Claude APIs', /\bopenai\b|\banthropic\b|\bclaude\b|\bgemini\b/i],
];
export const TECH_NAMES = TECH.map(([n]) => n);

const FE = new Set(['React', 'Next.js', 'Vue', 'Angular', 'Tailwind', 'HTML/CSS', 'TypeScript', 'JavaScript']);
const BE = new Set(['Go', 'Java', 'Spring', 'Python', 'Node.js', 'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Kafka', 'gRPC', 'Microservices', 'REST', 'Django', 'C#', 'PHP', 'Ruby', 'Rust']);

export function extractTech(text) {
  const out = [];
  for (const [name, re] of TECH) if (re.test(text)) out.push(name);
  return out;
}

// ---------- years of experience ----------
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function parseYears(raw) {
  if (!raw) return null;
  let t = raw.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:\+|-|–|to)?\s*(?:\d+\s*)?(?:years?|yrs?)\b)/g, (m) => String(WORD_NUM[m]));
  // "up to 3 years" / "less than 2 years" / "0-2 years" all mean fresh grads are fine
  t = t.replace(/\b(?:up to|less than|under|no more than|max(?:imum)?(?: of)?)\s*\d{1,2}\s*(?:years?|yrs?)/g, '0 years');
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/g;
  const found = [];
  let m;
  while ((m = re.exec(t))) {
    const lo = Number(m[1]);
    if (lo > 15) continue;
    const win = t.slice(Math.max(0, m.index - 70), m.index + m[0].length + 90);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 25);
    if (/^\s*(?:contract|renewable|bond|term|degree|program|course)/.test(after)) continue;
    if (!/experience|exp\b|background|track record|working in|working with|hands-on|professional/.test(win)) continue;
    if (/years? old|founded|over the (?:past|last)|in the (?:past|last)|for over \d+ years|history of|since \d{4}|within \d+ years|next \d+ years|\d+ years? (?:from now|ago)/.test(win)) continue;
    found.push(lo);
  }
  return found.length ? Math.min(...found) : null;
}

// ---------- role classification ----------
const RX = {
  seniorTitle: /\b(senior|sr\.?|staff|principal|lead|head|manager|director|architect|vp|distinguished|expert|specialist|consultant)\b|\b(?:II|III|IV|V)\b\s*(?:\(|$|,|-)|\bL[4-9]\b|\bE[4-9]\b/i,
  intern: /\b(intern|internship|attachment|co-?op|trainee|apprentice)\b/i,
  newGradTitle: /new[\s-]?grad|fresh(?:er)?[\s-]?grad|graduate (?:program|programme|engineer|developer|software)|\bgraduates?\b|campus|early[- ]career|entry[- ]level|\bjunior\b|\bjr\.?\b|\bassociate (?:software|engineer|developer)/i,
  explicitGrad: /new[\s-]?grad|fresh(?:er)?[\s-]?grad|recent(?:ly)? graduat|graduate (?:program|programme|engineer|developer|role|position|hire)|campus (?:hire|recruit)|early[- ]career|entry[- ]level|no (?:prior |previous )?(?:working |work |relevant |industry )?experience (?:is |are )?(?:required|needed|necessary)|fresh graduates? (?:are )?(?:welcome|encouraged)|graduating (?:in|by|before)|university graduates?|0\s*(?:-|to|–)\s*[12]\s*years?/i,
  ml: /\b(ml|machine learning|data scientist|research scientist|research engineer|computer vision|nlp|deep learning|algorithm engineer|algorithms? engineer|applied scientist|mlops|ml ?ops|model training|reinforcement learning|speech)\b/i,
  ai: /\b(ai|a\.i\.|llm|llms|agent|agents|agentic|generative|genai|gen ai|applied ai|prompt|rag|copilot|chatbot|conversational)\b/i,
  fullstack: /full[\s-]?stack/i,
  backend: /back[\s-]?end|server[\s-]?side|\bapi\b|\bplatform engineer|\bservices?\b|java (?:developer|engineer)|golang|\bgo (?:developer|engineer)|python (?:developer|engineer)|\.net|php|distributed|microservice|\brust\b|c\+\+ (?:developer|engineer)|trading (?:system|engine)|payments?/i,
  frontend: /front[\s-]?end|\bui\b|web developer|react|angular|\bvue\b|\bweb (?:engineer|app)|javascript developer|typescript developer/i,
  mobile: /android|\bios\b|mobile|flutter|react native|swift developer/i,
  data: /data engineer|big data|\betl\b|\bbi (?:developer|engineer)|analytics engineer|data (?:platform|pipeline)|database (?:engineer|administrator)|\bdba\b|data analyst/i,
  devops: /devops|\bsre\b|site reliability|infrastructure|cloud (?:engineer|architect)|systems? (?:engineer|administrator)|platform ops|release engineer|network engineer|\bsysadmin\b/i,
  qa: /\bqa\b|\btest(?:er|ing)?\b|\bsdet\b|quality (?:assurance|engineer)|automation test/i,
  security: /security|cyber|penetration|infosec|soc analyst|vulnerab/i,
  embedded: /embedded|firmware|fpga|hardware|robotic|\bplc\b|\bscada\b|mechatronic|electronic|\bcnc\b|\brf\b|asic|verification engineer|\bvlsi\b|automation engineer|control(?:s)? engineer|machine control|equipment|semiconductor|drone|avionics|autonomous/i,
  swe: /software|\bsde\b|\bswe\b|developer|programmer|engineer|coder|application (?:developer|engineer)/i,
  nonSwe: /sales engineer|solutions? engineer|support engineer|technical support|customer (?:success|support|service)|account|recruit|marketing|designer|analyst(?!.*(?:software|developer))|civil engineer|mechanical engineer|electrical engineer|chemical engineer|process engineer|site engineer|project engineer|field engineer|service engineer|application support|it support|helpdesk|help desk|technician|sales|business develop|pre-?sales|implementation (?:consultant|specialist)|\bproduct (?:manager|owner)\b|scrum master|business analyst|trader|quant(?:itative)? (?:researcher|analyst)|integration reliability|technical operations|techops|tech ?ops|technical writer|technical account|\badmin\b|administrat|coordinator|\bclerk\b|\bassistant\b(?!.*software)|manufacturing|facilit|data cent(?:re|er)|assembly|\baudit|operator|onboarding and connectivity/i,
};

export const ROLE_LABEL = {
  fullstack: 'Full-stack', backend: 'Backend', frontend: 'Frontend', ai: 'AI / Agent', software: 'Software (general)',
  ml: 'ML / Research', mobile: 'Mobile', data: 'Data', devops: 'DevOps / SRE', qa: 'QA / Test', security: 'Security', embedded: 'Embedded / Hardware', other: 'Other',
};

export function classifyRole(title, desc, techs) {
  const t = title || '';
  const swTitle = /software (?:engineer|developer|development)|\bsde\b|\bswe\b/i.test(t);
  if (RX.nonSwe.test(t) && !RX.fullstack.test(t) && !swTitle) return 'other';
  if (!RX.swe.test(t) && !RX.fullstack.test(t) && !/front[\s-]?end/i.test(t)) return 'other';
  if (RX.ml.test(t) && !/\bsoftware\b/i.test(t)) return 'ml';
  if (RX.embedded.test(t)) return 'embedded';
  if (RX.security.test(t)) return 'security';
  if (RX.qa.test(t)) return 'qa';
  if (swTitle ? /devops|\bsre\b|site reliability/i.test(t) : RX.devops.test(t)) return 'devops';
  if (RX.data.test(t)) return 'data';
  if (RX.mobile.test(t) && !RX.fullstack.test(t)) return 'mobile';
  if (RX.ai.test(t)) return RX.ml.test(t) ? 'ml' : 'ai';
  if (RX.fullstack.test(t)) return 'fullstack';
  const hasFE = RX.frontend.test(t), hasBE = RX.backend.test(t);
  if (hasFE && hasBE) return 'fullstack';
  if (hasBE) return 'backend';
  if (hasFE) return 'frontend';
  // generic "Software Engineer": decide from the tech stack in the description
  const fe = techs.filter((x) => FE.has(x)).length;
  const be = techs.filter((x) => BE.has(x)).length;
  if (fe >= 2 && be >= 2) return 'fullstack';
  if (be >= 2 && fe < 2) return 'backend';
  if (fe >= 2 && be < 2) return 'frontend';
  return 'software';
}

const SENIOR_LEVELS = new Set(['mid_senior_level', 'director', 'executive']);

const BRAND = { tiktok: 'TikTok', bytedance: 'ByteDance', garena: 'Garena', shopee: 'Shopee', grabtaxi: 'Grab', dbs: 'DBS', ocbc: 'OCBC', uob: 'UOB', ntt: 'NTT', sph: 'SPH', st: 'ST', ibm: 'IBM', aws: 'AWS', govtech: 'GovTech', okx: 'OKX', msi: 'MSI', ase: 'ASE', psb: 'PSB', hp: 'HP', 'gs': 'GS', 'cys': 'CYS', it: 'IT', ai: 'AI', ntu: 'NTU', nus: 'NUS', sg: 'SG', usa: 'USA' };
export function prettyCompany(name) {
  if (!name) return 'Unknown';
  if (name !== name.toUpperCase()) return name.trim();
  let s = name
    .replace(/\b(?:PTE\.?\s*LTD\.?|PRIVATE\s+LIMITED|PTE\.?\s*LIMITED|LIMITED|LTD\.?|PTE\.?|INC\.?|LLP|CORPORATION|CORP\.?)\s*$/gi, '')
    .replace(/\(\s*(?:SINGAPORE|S|SG)\s*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,.-]+$/, '')
    .trim();
  s = s.toLowerCase().replace(/[a-z0-9&@'.]+/g, (w) => BRAND[w] || w.charAt(0).toUpperCase() + w.slice(1));
  s = s.replace(/\bSingapore Singapore\b/, 'Singapore');
  return s || name;
}
const AGENCY_NAME = /\b(recruit\w*|staffing|manpower|randstad|adecco|hays|michael page|robert walters|kelly services|persolkelly|hrnet|reeracoen|aquent|morgan mckinley|jac recruitment|talent\w*|headhunt\w*|search firm|resourcing|personnel|outsourc\w*|spring professional|cpl|ideal consulting|hr (?:consult|solution)\w*|human resource\w*|careerbuilder|jobstreet|effort|ntuc|nus-iss|crew by|asia recruit|selby jennings|nigel frank|lorien|bluecrest)\b/i;
const AGENCY_TEXT = /\bEA\s*(?:licen[cs]e)?\s*(?:no\.?|number)?\s*:?\s*\d{2}[A-Z]\d{4}\b|\bEA\s*licen[cs]e\b|\bR\d{6,8}\b.*\bEA\b|only shortlisted candidates will be contacted.*\b(whatsapp|wechat)\b|\bour client\b|\bon behalf of (?:our|a) client\b|\bconfidential (?:client|company)\b|\b(?:direct )?role with client\b/i;

export function enrich(job) {
  const title = job.title || '';
  const desc = job.description || '';
  const head = `${title}\n${desc}`;
  const techs = extractTech(head);
  const role = classifyRole(title, desc, techs);

  const titleYears = /\b(?:min(?:imum)?\.?|at least|\d+\s*\+)\s*\d*\s*(?:years?|yrs?)|\(\s*\d{1,2}\s*(?:years?|yrs?)\s*\)|\b\d{1,2}\s*(?:-|to)\s*\d{1,2}\s*(?:years?|yrs?)/i.test(title)
    ? parseYears(title.replace(/(years?|yrs?)/i, '$1 experience'))
    : null;
  const parsedDesc = parseYears(desc);
  const parsed = titleYears ?? parsedDesc;
  const srcYears = typeof job.sourceMinYears === 'number' ? job.sourceMinYears : null;
  let years = parsed !== null && srcYears !== null ? Math.max(parsed, srcYears) : parsed ?? srcYears;

  const seniorTitle = RX.seniorTitle.test(title);
  const intern = RX.intern.test(title) || job.employmentTypes?.some((e) => /intern/i.test(e)) && !/permanent|full/i.test(job.employmentTypes.join(' '));
  const gradTitle = RX.newGradTitle.test(title);
  const explicitGrad = gradTitle || RX.explicitGrad.test(desc.slice(0, 4000));
  const srSenior = SENIOR_LEVELS.has(job.sourceLevel) && !explicitGrad;

  let tier;
  if (gradTitle && !seniorTitle) tier = 'fresh';
  else if (seniorTitle || (years !== null && years >= 3) || srSenior) tier = 'senior';
  else if (explicitGrad || (years !== null && years <= 1) || job.sourceLevel === 'Fresh/entry level' || job.sourceLevel === 'entry_level') tier = 'fresh';
  else if (years === 2 || job.sourceLevel === 'Junior Executive' || job.sourceLevel === 'associate') tier = 'junior';
  else tier = 'unknown';

  const agency = Boolean(job.agencyHint) || AGENCY_NAME.test(job.company || '') || AGENCY_TEXT.test(desc.slice(0, 6000));
  // aimed at polytechnic/ITE/diploma holders rather than degree graduates
  const diploma = /polytechnic|\bpoly\b|\bdiploma\b|\bnitec\b|\bITE\b/i.test(title);
  const noChinese = !/\b(?:mandarin|chinese)\b.{0,40}\b(?:required|fluent|proficien|must)|\b(?:fluent|proficien\w*|must).{0,40}\b(?:mandarin|chinese)\b/i.test(desc);

  return {
    ...job,
    company: prettyCompany(job.company),
    postedBy: job.postedBy ? prettyCompany(job.postedBy) : undefined,
    description: undefined,
    desc: desc.length > 4500 ? desc.slice(0, 4500) + '…' : desc,
    role,
    techs,
    years,
    tier,
    flags: { agency, intern: Boolean(intern), senior: tier === 'senior', explicitGrad, gradTitle: gradTitle && !seniorTitle, diploma, needsChinese: !noChinese },
  };
}
