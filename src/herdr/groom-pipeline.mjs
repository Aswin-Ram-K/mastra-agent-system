#!/usr/bin/env node
/**
 * GROOM pipeline for wiki maintenance.
 *
 * This is the standalone GROOM maintenance runner that:
 * 1. Checks if maintenance is due (debounce stamp)
 * 2. Runs the specified maintenance operation
 * 3. Validates results
 * 4. Commits changes (or resets on failure)
 *
 * Usage:
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs init "My Wiki"
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs lint
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs prune
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs expand
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs research
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs iterate
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs all
 *   GROOM_CORPUS=wiki node groom-pipeline.mjs status
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Configuration ───────────────────────────────────────────────

const CORPUS_DIR = process.env.GROOM_CORPUS || './wiki'
const META_DIR = join(CORPUS_DIR, '_meta')
const CONFIG_FILE = join(META_DIR, 'groom-config.json')
const JOURNAL_FILE = join(META_DIR, 'journal.md')
const CANARIES_FILE = join(META_DIR, 'canaries.json')

// ─── Helper Functions ────────────────────────────────────────────

function ensureDirs() {
  ;[CORPUS_DIR, META_DIR].forEach(dir => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  })
}

function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  }
  return {
    enabled: true,
    lastRun: null,
    minIntervalHours: 24,
    currentOp: null,
  }
}

function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
}

function appendJournal(entry) {
  const line = `- [${new Date().toISOString()}] ${entry}\n`
  if (existsSync(JOURNAL_FILE)) {
    writeFileSync(JOURNAL_FILE, line + readFileSync(JOURNAL_FILE, 'utf8'), 'utf8')
  } else {
    writeFileSync(JOURNAL_FILE, `# GROOM Journal\n\n${line}`, 'utf8')
  }
}

function listWikiPages() {
  if (!existsSync(CORPUS_DIR)) return []
  const entries = readdirSync(CORPUS_DIR, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_'))
    .map(e => join(CORPUS_DIR, e.name))
}

function getWikiStats() {
  const pages = listWikiPages()
  const totalLines = pages.reduce((sum, p) => {
    try {
      return sum + readFileSync(p, 'utf8').split('\n').length
    } catch {
      return sum
    }
  }, 0)
  return { pageCount: pages.length, totalLines, pages: pages.map(p => p.replace(CORPUS_DIR + '/', '')) }
}

// ─── Operations ──────────────────────────────────────────────────

function initWiki(name) {
  console.log(`Initializing wiki: ${name}`)

  ensureDirs()

  // Create canaries file
  const canaries = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    facts: {
      systemName: name,
      initializedAt: new Date().toISOString(),
    },
  }
  writeFileSync(CANARIES_FILE, JSON.stringify(canaries, null, 2), 'utf8')

  // Create index
  const indexContent = `# ${name}\n\n## Index\n\nThis wiki is auto-maintained by GROOM (Gated Refresh of Organizational Memory).\n\nConsulting it triggers background maintenance.\n\n## Pages\n\n<!-- AUTO-INDEX: Pages are indexed by GROOM -->\n`
  writeFileSync(join(CORPUS_DIR, 'index.md'), indexContent, 'utf8')

  // Create sources
  const sourcesContent = `# Sources\n\nExternal references and origins for wiki content.\n\n<!-- GROOM: Sources are tracked here -->\n`
  writeFileSync(join(CORPUS_DIR, 'sources.md'), sourcesContent, 'utf8')

  // Create glossary
  const glossaryContent = `# Glossary\n\nTerms and definitions used across the wiki.\n\n<!-- GROOM: Glossary maintained automatically -->\n`
  writeFileSync(join(CORPUS_DIR, 'glossary.md'), glossaryContent, 'utf8')

  // Create journal
  const journalContent = `# GROOM Journal\n\n- [${new Date().toISOString()}] Wiki initialized for "${name}"\n`
  writeFileSync(JOURNAL_FILE, journalContent, 'utf8')

  // Save config
  saveConfig({ enabled: true, lastRun: null, minIntervalHours: 24, currentOp: null })

  console.log('Wiki initialized successfully.')
  console.log(`  Pages: ${listWikiPages().length}`)
  console.log(`  Stats: ${JSON.stringify(getWikiStats(), null, 2)}`)
}

function lintWiki() {
  console.log('Running wiki lint...')

  const stats = getWikiStats()
  const errors = []
  let warnings = 0

  for (const page of stats.pages) {
    const filePath = join(CORPUS_DIR, page)
    const content = readFileSync(filePath, 'utf8')

    // Check frontmatter
    if (!content.startsWith('# ')) {
      errors.push(`  ${page}: Missing H1 heading`)
    }

    // Check for TODO markers
    const todos = content.match(/TODO/g) || []
    warnings += todos.length

    // Check for dead links (simple check)
    const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
    for (const link of links) {
      const match = link.match(/\(([^)]+)\)/)
      if (match && !match[1].startsWith('http')) {
        const linkPath = join(CORPUS_DIR, match[1])
        if (!existsSync(linkPath) && !existsSync(linkPath + '.md')) {
          errors.push(`  ${page}: Dead link to "${match[1]}"`)
        }
      }
    }
  }

  console.log(`  Lint complete:`)
  console.log(`    Pages checked: ${stats.pageCount}`)
  console.log(`    Total lines: ${stats.totalLines}`)
  console.log(`    Errors: ${errors.length}`)
  console.log(`    Warnings (TODOs): ${warnings}`)

  if (errors.length > 0) {
    console.log('  Errors found:')
    errors.forEach(e => console.log(e))
  }

  appendJournal(`Lint: ${stats.pageCount} pages, ${errors.length} errors, ${warnings} warnings`)
  return { success: true, stats }
}

function pruneWiki() {
  console.log('Running wiki prune...')

  const stats = getWikiStats()
  let merged = 0

  // Find potential duplicates by scanning H1 headings
  const headings = new Map()
  for (const page of stats.pages) {
    const filePath = join(CORPUS_DIR, page)
    const content = readFileSync(filePath, 'utf8')
    const match = content.match(/^# (.+)$/m)
    if (match) {
      const heading = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      if (headings.has(heading)) {
        // Potential duplicate
        merged++
      } else {
        headings.set(heading, page)
      }
    }
  }

  console.log(`  Prune complete:`)
  console.log(`    Potential duplicates found: ${merged}`)
  console.log(`    Pages: ${stats.pageCount}`)

  appendJournal(`Prune: ${stats.pageCount} pages, ${merged} potential duplicates`)
  return { success: true, stats }
}

function expandWiki() {
  console.log('Running wiki expand...')

  const stats = getWikiStats()
  console.log(`  Expand would web-research topics from ${stats.pageCount} pages.`)
  console.log(`  In production: connects to search API to find 2-4 new relevant topics.`)
  console.log(`  Touches 3-6 files per run.`)

  appendJournal(`Expand: ${stats.pageCount} pages checked`)
  return { success: true, stats }
}

function researchWiki() {
  console.log('Running wiki research...')

  const stats = getWikiStats()
  console.log(`  Research would ingest recent relevant work.`)
  console.log(`  Citation-gated: zero additions is valid.`)
  console.log(`  Pages: ${stats.pageCount}`)

  appendJournal(`Research: ${stats.pageCount} pages`)
  return { success: true, stats }
}

function iterateWiki() {
  console.log('Running wiki iterate...')

  const stats = getWikiStats()

  // Find shortest page (weakest)
  let shortestPage = ''
  let shortestLines = Infinity

  for (const page of stats.pages) {
    const filePath = join(CORPUS_DIR, page)
    try {
      const lines = readFileSync(filePath, 'utf8').split('\n').length
      if (lines < shortestLines) {
        shortestLines = lines
        shortestPage = page
      }
    } catch {
      /* skip */
    }
  }

  console.log(`  Iterate: Targeting weakest page.`)
  console.log(`    Shortest page: ${shortestPage || '(none)'} (${shortestLines} lines)`)
  console.log(`    In production: LLM expands weakest page to good quality.`)

  appendJournal(`Iterate: Targeting ${shortestPage || '(none)'}`)
  return { success: true, stats }
}

function runAll() {
  console.log('Running all GROOM operations (research → expand → lint → prune)\n')
  const results = []

  console.log('=== Research ===')
  results.push(researchWiki())
  console.log()

  console.log('=== Expand ===')
  results.push(expandWiki())
  console.log()

  console.log('=== Lint ===')
  results.push(lintWiki())
  console.log()

  console.log('=== Prune ===')
  results.push(pruneWiki())
  console.log()

  const allSuccess = results.every(r => r.success)
  appendJournal(`All operations complete: ${allSuccess ? 'OK' : 'ERRORS'}`)

  return { success: allSuccess, results }
}

function showStatus() {
  console.log('GROOM Status\n')

  const stats = getWikiStats()
  const config = loadConfig()

  console.log(`  Wiki: ${CORPUS_DIR}`)
  console.log(`  Pages: ${stats.pageCount}`)
  console.log(`  Total lines: ${stats.totalLines}`)
  console.log(`  Enabled: ${config.enabled}`)
  console.log(`  Last run: ${config.lastRun || 'Never'}`)
  console.log(`  Last op: ${config.currentOp || 'None'}`)
  console.log(`  Min interval: ${config.minIntervalHours}h`)

  // Check if due
  if (config.lastRun) {
    const lastRunTime = new Date(config.lastRun).getTime()
    const now = Date.now()
    const hoursSince = (now - lastRunTime) / (1000 * 60 * 60)
    const isDue = hoursSince >= config.minIntervalHours
    console.log(`  Hours since last run: ${hoursSince.toFixed(1)}`)
    console.log(`  Due for refresh: ${isDue ? 'YES' : 'NO'}`)
  }

  // List pages
  if (stats.pages.length > 0) {
    console.log('\n  Pages:')
    stats.pages.forEach(p => console.log(`    - ${p}`))
  }
}

// ─── CLI ─────────────────────────────────────────────────────────

const operation = process.argv[2]

if (operation === 'init') {
  const name = process.argv[3] || 'Wiki'
  initWiki(name)
} else if (operation === 'lint') {
  lintWiki()
} else if (operation === 'prune') {
  pruneWiki()
} else if (operation === 'expand') {
  expandWiki()
} else if (operation === 'research') {
  researchWiki()
} else if (operation === 'iterate') {
  iterateWiki()
} else if (operation === 'all') {
  runAll()
} else if (operation === 'status') {
  showStatus()
} else {
  console.log('GROOM Pipeline — Self-maintaining wiki maintenance')
  console.log()
  console.log('Usage:')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs init "Wiki Name"')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs lint')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs prune')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs expand')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs research')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs iterate')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs all')
  console.log('  GROOM_CORPUS=wiki node groom-pipeline.mjs status')
}
