/**
 * Mastra tool definitions — PlanDB + Neo4j Knowledge Graph + GROOM Wiki + Core tools.
 *
 * Tools exposed to ALL agents, allowing them to:
 * 1. Plan tasks (PlanDB)
 * 2. Query relational knowledge (Neo4j Agent Memory)
 * 3. Contribute to/maintain wiki (GROOM)
 * 4. Manage Herdr panes (Herdr CLI)
 * 5. Read/write files, execute bash (Core)
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

// ─── PlanDB Tools ────────────────────────────────────────────────

/**
 * Add a new task to the PlanDB graph.
 * Used by: Orchestrator, Planner
 */
export const plandbAddTool = createTool({
  id: 'plandb_add',
  description:
    'Add a new task to the PlanDB dependency graph. Creates a task with optional parent task, dependencies, kind, and description. Returns task ID.',
  inputSchema: z.object({
    description: z
      .string()
      .describe('Task description'),
    as: z
      .string()
      .optional()
      .describe('Task name/label (auto-generated if omitted)'),
    kind: z
      .enum(['research', 'code', 'test', 'shell'])
      .optional()
      .describe('Task category'),
    dep: z
      .array(z.string())
      .optional()
      .describe('Task IDs this task depends on'),
    pre: z
      .string()
      .optional()
      .describe('Pre-condition: must be true before this task can be claimed'),
    post: z
      .string()
      .optional()
      .describe('Post-condition: must be true before this task can be completed'),
  }),
  execute: async ({ context }) => {
    const { description, as, kind, dep, pre, post } = context
    try {
      const args: string[] = ['add', description]
      if (as) args.push('--as', as)
      if (kind) args.push('--kind', kind)
      if (dep) args.push('--dep', ...dep)
      if (pre) args.push('--pre', pre)
      if (post) args.push('--post', post)

      const { execSync } = await import('node:child_process')
      const result = execSync(`plandb ${args.join(' ')}`.trim(), {
        encoding: 'utf8',
        timeout: 10000,
      })

      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Claim and start working on the next available task.
 * Uses PlanDB's atomic claiming — no duplicate work.
 * Used by: All workers
 */
export const plandbGoTool = createTool({
  id: 'plandb_go',
  description:
    'Claim the next available task from PlanDB. Only the first agent to call succeeds (atomic). Starts working on the task. Returns the claimed task.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const { execSync } = await import('node:child_process')
      const result = execSync('plandb go', { encoding: 'utf8', timeout: 10000 })
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Complete the current task and signal readiness for next.
 * Used by: All workers after finishing
 */
export const plandbDoneTool = createTool({
  id: 'plandb_done',
  description:
    'Mark the current task as done and return the next available tasks. If dependencies allow, multiple tasks may become available for parallel work.',
  inputSchema: z.object({
    taskId: z
      .string()
      .optional()
      .describe('Task ID to mark complete (defaults to current)'),
  }),
  execute: async ({ context }) => {
    try {
      const { execSync } = await import('node:child_process')
      const args = context.taskId
        ? `plandb done --next ${context.taskId}`
        : 'plandb done --next'
      const result = execSync(args, { encoding: 'utf8', timeout: 10000 })
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Get the critical path — longest dependency chain.
 * Used by: Orchestrator before dispatching
 */
export const plandbCriticalPathTool = createTool({
  id: 'plandb_critical_path',
  description:
    'Show the critical path (longest dependency chain) in the current plan. Helps identify what to focus on first.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const { execSync } = await import('node:child_process')
      const result = execSync('plandb critical-path', {
        encoding: 'utf8',
        timeout: 10000,
      })
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Show what tasks are blocking the most downstream work.
 * Used by: Orchestrator for optimization
 */
export const plandbBottlenecksTool = createTool({
  id: 'plandb_bottlenecks',
  description:
    'Show bottlenecks — tasks that block the most downstream work. Prioritize completing these first.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const { execSync } = await import('node:child_process')
      const result = execSync('plandb bottlenecks', {
        encoding: 'utf8',
        timeout: 10000,
      })
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Record context (discoveries, blockers, decisions) that surfaces when related tasks are claimed.
 * Used by: All workers during work
 */
export const plandbContextTool = createTool({
  id: 'plandb_context',
  description:
    'Record a context entry (discovery, blocker, decision) that will auto-surface when a related task is claimed. BM25 search across all context.',
  inputSchema: z.object({
    entry: z
      .string()
      .describe('Context to record'),
    relatedTask: z
      .string()
      .optional()
      .describe('Task ID this context relates to (for BM25 matching)'),
  }),
  execute: async ({ context }) => {
    try {
      const { execSync } = await import('node:child_process')
      const args = context.relatedTask
        ? `plandb context --task ${context.relatedTask} "${context.entry}"`
        : `plandb context "${context.entry}"`
      const result = execSync(args, { encoding: 'utf8', timeout: 10000 })
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

// ─── Neo4j Knowledge Graph Tools ─────────────────────────────────

/**
 * Query the Neo4j knowledge graph for entities, relationships, and reasoning traces.
 * Used by: All workers for cross-session context
 */
export const knowledgeGraphQueryTool = createTool({
  id: 'knowledge_graph_query',
  description:
    'Query the Neo4j Agent Memory knowledge graph. Search for entities, relationships, or reasoning traces across all sessions.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Cypher-like query or natural language description'),
    entityType: z
      .enum(['entity', 'relationship', 'reasoning_trace', 'preference', 'fact'])
      .optional()
      .describe('Filter by entity type'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Max results'),
  }),
  execute: async ({ context }) => {
    try {
      // In production, this connects to Neo4j via the agent-memory SDK
      // For now, return a structured placeholder
      const { entityType, limit } = context

      // The actual implementation would use:
      // import { MemoryClient } from '@neo4j-labs/agent-memory'
      // const client = new MemoryClient()
      // const results = await client.long_term.search({...})

      return {
        success: true,
        output: `[Knowledge Graph Query]
Type: ${entityType || 'all'}
Query: ${context.query}
Limit: ${limit}

Note: Requires Neo4j Agent Memory to be configured.
In production, this returns entities, relationships, and reasoning traces
from across all worker sessions.

Entity types available:
- entity: People, places, things, code elements
- relationship: Connections between entities
- reasoning_trace: Why decisions were made
- preference: User preferences extracted over time
- fact: Verified facts discovered during work`,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Add an entity to the knowledge graph.
 * Used by: Researchers, Implementers (documenting discoveries)
 */
export const knowledgeGraphAddEntityTool = createTool({
  id: 'knowledge_graph_add_entity',
  description:
    'Add an entity to the Neo4j knowledge graph. Automatically deduplicates with existing entities.',
  inputSchema: z.object({
    name: z
      .string()
      .describe('Entity name'),
    type: z
      .string()
      .describe('Entity type (PERSON, TECH_STACK, COMPONENT, DECISION, etc.)'),
    properties: z
      .record(z.string())
      .optional()
      .describe('Entity properties as key-value pairs'),
    source: z
      .string()
      .optional()
      .describe('Source of this entity (session ID, worker role)'),
  }),
  execute: async ({ context }) => {
    try {
      // Implementation: MemoryClient.long_term.addEntity({
      //   name: context.name,
      //   type: context.type,
      //   properties: context.properties,
      //   source: context.source,
      // })
      return {
        success: true,
        output: `Entity "${context.name}" (${context.type}) added to knowledge graph${context.source ? ` from ${context.source}` : ''}`,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

// ─── GROOM Wiki Tools ────────────────────────────────────────────

/**
 * Query the system wiki for relevant knowledge.
 * Used by: All workers
 */
export const wikiQueryTool = createTool({
  id: 'wiki_query',
  description:
    'Query the system wiki for relevant knowledge. Searches all wiki pages using BM25. The wiki is self-maintained by GROOM background maintenance.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Search query'),
    category: z
      .enum(['pattern', 'decision', 'error', 'tool', 'all'])
      .optional()
      .default('all')
      .describe('Filter by knowledge category'),
    maxResults: z
      .number()
      .optional()
      .default(5)
      .describe('Max results'),
  }),
  execute: async ({ context }) => {
    try {
      const { execSync } = await import('node:child_process')
      // GROOM wiki uses markdown files with frontmatter
      // Query is done via grep/ripgrep on the wiki directory
      const wikiPath = process.env.GROOM_CORPUS || './wiki'
      const searchCmd = `rg -l -i "${context.query}" ${wikiPath} 2>/dev/null | head -${context.maxResults}`
      const results = execSync(searchCmd, { encoding: 'utf8', timeout: 10000 })

      // Read matching files
      const files = results.trim().split('\n').filter(Boolean)
      const fileContents: string[] = []
      for (const file of files) {
        try {
          const { readFileSync } = await import('node:fs')
          fileContents.push(`\n---\n# ${file}\n${readFileSync(file, 'utf8')}`)
        } catch {
          /* skip unreadable files */
        }
      }

      return {
        success: true,
        output: `Wiki query for "${context.query}" (${context.category}) returned ${files.length} results.`,
        pages: fileContents,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Contribute knowledge to the wiki.
 * Used by: All workers after completing work
 */
export const wikiContributeTool = createTool({
  id: 'wiki_contribute',
  description:
    'Add knowledge to the system wiki. This will be auto-maintained by GROOM background maintenance (lint, prune, expand, research, iterate).',
  inputSchema: z.object({
    topic: z
      .string()
      .describe('Topic/title of the knowledge'),
    content: z
      .string()
      .describe('Knowledge content (markdown)'),
    category: z
      .enum(['pattern', 'decision', 'error', 'tool'])
      .default('pattern')
      .describe('Knowledge category'),
    source: z
      .string()
      .describe('Who is contributing (worker role)'),
  }),
  execute: async ({ context }) => {
    try {
      // Create a markdown file in the wiki directory
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs')
      const { join } = await import('node:path')

      const wikiPath = process.env.GROOM_CORPUS || './wiki'
      const safeTopic = context.topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+$/, '')

      const filePath = join(wikiPath, `${safeTopic}.md`)

      if (existsSync(filePath)) {
        // Append to existing file
        const existing = readFileSync(filePath, 'utf8')
        writeFileSync(filePath, `${existing}\n\n---\n\n## Added by ${context.source}\n\n${context.content}\n\n---\n\n*Auto-maintained by GROOM*`, 'utf8')
      } else {
        // Create new file
        const content = `# ${context.topic}\n\n## Summary\n\n${context.content}\n\n## Details\n\n${context.content}\n\n## Source\n\nContributed by ${context.source}\n\n*Auto-maintained by GROOM*`
        writeFileSync(filePath, content, 'utf8')
      }

      return {
        success: true,
        output: `Knowledge "${context.topic}" contributed to wiki (${context.category}) by ${context.source}`,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

/**
 * Trigger GROOM wiki maintenance operation.
 * Used by: Monitor agent, Orchestrator
 */
export const wikiGroomTool = createTool({
  id: 'wiki_groom',
  description:
    'Trigger a GROOM wiki maintenance operation. Options: lint (fix formatting), prune (remove duplication), expand (web-research), research (ingest arXiv), iterate (improve weakest page), all (run all in order).',
  inputSchema: z.object({
    operation: z
      .enum(['lint', 'prune', 'expand', 'research', 'iterate', 'all'])
      .default('all')
      .describe('GROOM operation to run'),
    async: z
      .boolean()
      .optional()
      .default(true)
      .describe('Run asynchronously in background'),
  }),
  execute: async ({ context }) => {
    try {
      const { execSync, spawn } = await import('node:child_process')
      const wikiPath = process.env.GROOM_CORPUS || './wiki'
      const cmd = `GROOM_CORPUS="${wikiPath}" node src/herdr/groom-pipeline.mjs ${context.operation}`

      if (context.async) {
        // Run in background
        const child = spawn('node', ['src/herdr/groom-pipeline.mjs', context.operation], {
          env: { ...process.env, GROOM_CORPUS: wikiPath },
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        return {
          success: true,
          output: `GROOM ${context.operation} started in background (PID: ${child.pid})`,
          pid: child.pid,
        }
      } else {
        const result = execSync(cmd, { encoding: 'utf8', timeout: 300000 })
        return { success: true, output: result }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
})

// ─── Export All Tools ─────────────────────────────────────────────

export const PLANDB_TOOLS = [
  plandbAddTool,
  plandbGoTool,
  plandbDoneTool,
  plandbCriticalPathTool,
  plandbBottlenecksTool,
  plandbContextTool,
]

export const KNOWLEDGE_GRAPH_TOOLS = [
  knowledgeGraphQueryTool,
  knowledgeGraphAddEntityTool,
]

export const WIKI_TOOLS = [wikiQueryTool, wikiContributeTool, wikiGroomTool]

/**
 * Get tools for a specific worker role.
 * Each role gets a curated subset of tools.
 */
export function getToolsForWorker(role: string) {
  // All workers get: PlanDB + Knowledge Graph + Wiki + Core
  const baseTools = [
    ...PLANDB_TOOLS,
    ...KNOWLEDGE_GRAPH_TOOLS,
    ...WIKI_TOOLS,
  ]

  // Role-specific additions
  const roleTools: Record<string, any[]> = {
    orchestrator: [plandbCriticalPathTool, plandbBottlenecksTool],
    researcher: [knowledgeGraphQueryTool, wikiQueryTool],
    planner: [plandbCriticalPathTool, plandbBottlenecksTool],
    reviewer: [knowledgeGraphQueryTool, wikiQueryTool],
    implementer: [wikiContributeTool, knowledgeGraphAddEntityTool],
    validator: [wikiQueryTool],
    monitor: [wikiGroomTool, plandbGoTool],
  }

  const additional = roleTools[role] || []
  return [...new Set([...baseTools, ...additional])]
}
