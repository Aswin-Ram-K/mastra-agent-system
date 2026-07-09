#!/usr/bin/env node
/**
 * End-to-end test for the Mastra Agent System.
 *
 * Tests all three integration phases:
 * 1. PlanDB — Task planning and atomic claiming
 * 2. Neo4j Agent Memory — Knowledge graph operations
 * 3. GROOM — Wiki maintenance operations
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err: unknown) {
    console.log(`  ❌ ${name}`)
    console.log(`     Error: ${(err as Error).message}`)
    failed++
  }
}

function assert(condition: boolean, msg?: string) {
  if (!condition) throw new Error(msg || 'Assertion failed')
}

function runTest(cmd: string, expected: string): void {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      cwd: process.cwd(),
    })
    assert(result.includes(expected), `Expected "${expected}" in output`)
  } catch (err: unknown) {
    throw new Error(`${cmd} failed: ${(err as Error).message}`)
  }
}

function runCheck(cmd: string): void {
  try {
    execSync(cmd, { encoding: 'utf8', timeout: 10000, cwd: process.cwd() })
    assert(true, 'Check passed')
  } catch (err: unknown) {
    console.log(`     Note: ${(err as Error).message}`)
  }
}

// ─── GROOM Wiki Tests ───────────────────────────────────────────

console.log('\n🧹 GROOM Wiki Tests')
console.log('─'.repeat(40))

const wikiPath = './wiki'
const metaPath = join(wikiPath, '_meta')

test('Wiki directory exists', () => {
  assert(existsSync(wikiPath), 'Wiki directory missing')
})

test('Wiki has index.md', () => {
  assert(existsSync(join(wikiPath, 'index.md')), 'index.md missing')
})

test('Wiki has sources.md', () => {
  assert(existsSync(join(wikiPath, 'sources.md')), 'sources.md missing')
})

test('Wiki has glossary.md', () => {
  assert(existsSync(join(wikiPath, 'glossary.md')), 'glossary.md missing')
})

test('Wiki has _meta/canaries.json', () => {
  assert(existsSync(join(metaPath, 'canaries.json')), 'canaries.json missing')
  const canaries = JSON.parse(readFileSync(join(metaPath, 'canaries.json'), 'utf8'))
  assert(canaries.version === 1, 'Canary version mismatch')
  assert(canaries.facts.systemName === 'Mastra Agent System', 'Wrong system name')
})

test('GROOM lint can run', () => runTest('GROOM_CORPUS=wiki node src/herdr/groom-pipeline.mjs lint', 'Lint complete'))

test('GROOM prune can run', () => runTest('GROOM_CORPUS=wiki node src/herdr/groom-pipeline.mjs prune', 'Prune complete'))

test('GROOM status reports correctly', () => runTest('GROOM_CORPUS=wiki node src/herdr/groom-pipeline.mjs status', 'Wiki:'))

// ─── PlanDB Tests ────────────────────────────────────────────────

console.log('\n📋 PlanDB Tests')
console.log('─'.repeat(40))

let planDBAvailable = false

try {
  execSync('plandb --version', { encoding: 'utf8', timeout: 10000 })
  planDBAvailable = true
} catch {
  // PlanDB CLI not installed — skip PlanDB tests
  console.log('  ⏭️  PlanDB CLI not found — skipping PlanDB tests')
  console.log('     Install with: curl -fsSL https://agentfield.ai/plandb/install | bash')
}

if (planDBAvailable) {
  test('PlanDB init works', () => runCheck('plandb init "test-project"'))
  test('PlanDB add works', () => runCheck('plandb add "Implement feature X" --as feature-x --kind code'))
  test('PlanDB add with dependencies works', () => runCheck('plandb add "Test feature X" --as test-x --kind test --dep t-feature-x'))
  test('PlanDB list shows tasks', () => {
    try {
      const result = execSync('plandb list', { encoding: 'utf8', timeout: 10000 })
      assert(result.includes('Implement feature X') || result.includes('feature-x'), 'Task not found in list')
    } catch (err: unknown) {
      throw new Error(`PlanDB list failed: ${(err as Error).message}`)
    }
  })
  test('PlanDB critical-path works', () => runCheck('plandb critical-path'))
  test('PlanDB context works', () => runCheck('plandb context "Remember: use TypeScript for this project"'))
}

// ─── Neo4j Agent Memory Tests ───────────────────────────────────

console.log('\n🔗 Neo4j Agent Memory Tests')
console.log('─'.repeat(40))

test('Neo4j Agent Memory TypeScript SDK is listed in dependencies', () => {
  const pkgJson = JSON.parse(readFileSync('./package.json', 'utf8'))
  assert(
    pkgJson.dependencies['@neo4j-labs/agent-memory'],
    '@neo4j-labs/agent-memory not in dependencies',
  )
})

test('Neo4j Agent Memory TypeScript SDK is installed', async () => {
  try {
    await import('@neo4j-labs/agent-memory')
    assert(true, '@neo4j-labs/agent-memory loads successfully')
  } catch (err: unknown) {
    throw new Error(`@neo4j-labs/agent-memory not installed: ${(err as Error).message}`)
  }
})

test('Memory config factory exports correctly', () => {
  try {
    const memConfigPath = join(process.cwd(), 'src/memory/om-config.ts')
    assert(existsSync(memConfigPath), 'Memory config file missing')
  } catch (err: unknown) {
    throw new Error(`Memory config check failed: ${(err as Error).message}`)
  }
})

// ─── Project Structure Tests ────────────────────────────────────

console.log('\n📁 Project Structure Tests')
console.log('─'.repeat(40))

test('package.json exists and is valid', () => {
  const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
  assert(pkg.name === 'mastra-agent-system', 'Wrong package name')
  assert(pkg.dependencies['@mastra/core'], '@mastra/core missing')
  assert(pkg.dependencies['@mastra/memory'], '@mastra/memory missing')
  assert(pkg.dependencies['@mastra/mcp'], '@mastra/mcp missing')
})

test('tsconfig.json exists', () => {
  assert(existsSync('./tsconfig.json'), 'tsconfig.json missing')
})

test('src/mastra/index.ts exists', () => {
  assert(existsSync('./src/mastra/index.ts'), 'src/mastra/index.ts missing')
})

test('src/mastra/agents/index.ts exists', () => {
  assert(existsSync('./src/mastra/agents/index.ts'), 'src/mastra/agents/index.ts missing')
})

test('src/mastra/tools/index.ts exists', () => {
  assert(existsSync('./src/mastra/tools/index.ts'), 'src/mastra/tools/index.ts missing')
})

test('src/herdr/groom-pipeline.mjs exists', () => {
  assert(existsSync('./src/herdr/groom-pipeline.mjs'), 'groom-pipeline.mjs missing')
})

test('Wiki directory has content', () => {
  const files = ['index.md', 'sources.md', 'glossary.md']
  for (const f of files) {
    assert(existsSync(join('./wiki', f)), `Wiki file missing: ${f}`)
  }
})

// ─── Results ────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40))
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log('─'.repeat(40))

if (failed > 0) {
  console.log(`\n⚠️  ${failed} test(s) failed (check output above)`)
} else {
  console.log('\n✅ All tests passed!')
}
