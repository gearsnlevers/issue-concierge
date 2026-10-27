// The end-to-end runner's view of GitHub: the few calls it needs, made with the `gh` CLI (GH_TOKEN names the identity).
// A failed call that looks transient (a 5xx, a timeout, a dropped connection) is repeated a few times, because the
// runner waits for long chains of workflows and must not fail a scenario over one gateway error.
// `run(args, input)` is injectable so the tests can answer without a network.
import { execFileSync } from 'node:child_process';

const TRANSIENT = /HTTP 5\d\d|timed? ?out|ECONN|socket hang up|EAI_AGAIN|temporar|secondary rate limit/i;

export function ghRunner(env = process.env) {
  return (args, input) =>
    execFileSync('gh', args, { encoding: 'utf8', env, input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

function parse(out, paginate) {
  if (!out || !out.trim()) return null;
  const data = JSON.parse(out);
  if (!paginate) return data;
  // `--paginate --slurp` gives one entry per page: an array for a list, an object that wraps the list otherwise.
  return data.flatMap((page) => (Array.isArray(page) ? page : Object.values(page).find(Array.isArray) ?? []));
}

export function createGitHub({ run = ghRunner(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3, now = Date.now, cacheMs = 20000 } = {}) {
  async function api(method, path, body, { paginate = false } = {}) {
    const args = ['api', '-X', method, path, ...(paginate ? ['--paginate', '--slurp'] : []), ...(body ? ['--input', '-'] : [])];
    for (let attempt = 0; ; attempt++) {
      try {
        return parse(run(args, body ? JSON.stringify(body) : undefined), paginate);
      } catch (error) {
        const message = String(error.stderr || error.message || error);
        if (attempt < retries && TRANSIENT.test(message)) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        const wrapped = new Error(`${method} ${path}: ${message.trim().split('\n')[0]}`);
        wrapped.status = Number(message.match(/HTTP (\d{3})/)?.[1]) || 0;
        throw wrapped;
      }
    }
  }

  // Lists that every scenario of a suite asks for are shared for a few seconds, so that many scenarios polling at once
  // stay far below the rate limit.
  const cache = new Map();
  async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.value;
    const value = await load();
    cache.set(key, { at: now(), value });
    return value;
  }

  const enc = encodeURIComponent;
  return {
    api,
    user: () => api('GET', '/user'),
    getIssue: (repo, n) => api('GET', `/repos/${repo}/issues/${n}`),
    createIssue: (repo, { title, body, labels }) => api('POST', `/repos/${repo}/issues`, { title, body, labels }),
    comment: (repo, n, body) => api('POST', `/repos/${repo}/issues/${n}/comments`, { body }),
    addLabels: (repo, n, labels) => api('POST', `/repos/${repo}/issues/${n}/labels`, { labels }),
    async removeLabel(repo, n, label) {
      try {
        await api('DELETE', `/repos/${repo}/issues/${n}/labels/${enc(label)}`);
      } catch (error) {
        if (error.status !== 404) throw error; // already gone
      }
    },
    closeIssue: (repo, n, reason) => api('PATCH', `/repos/${repo}/issues/${n}`, { state: 'closed', state_reason: reason }),
    listComments: (repo, n) => api('GET', `/repos/${repo}/issues/${n}/comments?per_page=100`, undefined, { paginate: true }),
    timeline: (repo, n) => api('GET', `/repos/${repo}/issues/${n}/timeline?per_page=100`, undefined, { paginate: true }),
    listRuns: (repo, since) =>
      cached(`runs ${repo} ${since}`, () => api('GET', `/repos/${repo}/actions/runs?created=${enc(`>=${since}`)}&per_page=100`, undefined, { paginate: true })),
    listBotIssues: (repo, since) =>
      cached(`bot ${repo} ${since}`, async () => {
        const issues = await api('GET', `/repos/${repo}/issues?state=all&creator=${enc('github-actions[bot]')}&since=${enc(since)}&per_page=100`, undefined, { paginate: true });
        return issues.filter((i) => !i.pull_request && i.created_at >= since);
      }),
    listOpenIssues: (repo) => api('GET', `/repos/${repo}/issues?state=open&per_page=100`, undefined, { paginate: true }).then((all) => all.filter((i) => !i.pull_request)),
    dispatch: (repo, workflow, inputs = {}) => api('POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`, { ref: 'main', inputs }),
    async readFile(repo, path) {
      const file = await api('GET', `/repos/${repo}/contents/${path}`);
      return Buffer.from(file.content, 'base64').toString('utf8');
    },
  };
}
