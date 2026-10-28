// Runs a plain Jasmine-style spec (describe/it/expect, no Angular TestBed)
// under Node: npx tsx web/scripts/run-spec.mts <spec file>
const failures: string[] = [];
let passed = 0;
const suite: string[] = [];

const g = globalThis as Record<string, unknown>;
g['describe'] = (name: string, fn: () => void) => {
  suite.push(name);
  fn();
  suite.pop();
};
g['it'] = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${[...suite, name].join(' > ')}: ${(e as Error).message}`);
  }
};
g['expect'] = (actual: unknown) => {
  const fail = (msg: string) => {
    throw new Error(msg);
  };
  const s = (v: unknown) => JSON.stringify(v);
  return {
    toBe: (exp: unknown) => actual === exp || fail(`expected ${s(actual)} to be ${s(exp)}`),
    toEqual: (exp: unknown) => s(actual) === s(exp) || fail(`expected ${s(actual)} to equal ${s(exp)}`),
    toBeNull: () => actual === null || fail(`expected ${s(actual)} to be null`),
  };
};

const file = process.argv[2];
if (!file) throw new Error('Usage: run-spec.mts <spec file>');
await import(new URL(file, `file://${process.cwd()}/`).href);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
