/**
 * Mastra instance — unified orchestration with PlanDB, Neo4j Agent Memory, GROOM, and Herdr.
 *
 * Architecture:
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  Mastra Instance                                                 │
 *  │                                                                  │
 *  │  Storage: LibSQLStore (tasks, threads, sessions)                │
 *  │  Memory:  OM (Observational Memory) + Neo4j Agent Memory        │
 *  │  Workers: 7 Mastra agents (orchestrator + 6 workers)            │
 *  │  Tools:   Core tools + PlanDB + Knowledge Graph + Wiki + Herdr  │
 *  │  MCP:     PlanDB MCP server + Neo4j MCP server (inbound)        │
 *  │  Background: GROOM wiki maintenance                             │
 *  └──────────────────────────────────────────────────────────────────┘
 */

import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { Memory } from '@mastra/memory'
import { createAgentMemory } from '../memory/om-config'
import { createAgents } from './agents'
import { createTools } from './tools'
import { createWorkflows } from './workflows'
import { registerGroomPipeline } from '../herdr/groom-pipeline'

// ─── Configuration ─────────────────────────────────────────────────

interface AgentSystemConfig {
  /** Base URL for OpenAI-compatible endpoint (vLLM default) */
  openaiCompatibleBaseUrl?: string
  /** API key for OpenAI-compatible endpoint */
  apiKey?: string
  /** Path to SQLite database */
  dbPath?: string
  /** Path to Neo4j bolt connection (or use NAMS API key) */
  neo4jUri?: string
  /** Neo4j username */
  neo4jUser?: string
  /** Neo4j password */
  neo4jPassword?: string
  /** NAMS API key (alternative to self-hosted Neo4j) */
  namsApiKey?: string
  /** GROOM corpus path */
  groomCorpus?: string
  /** PlanDB project name for default workspace */
  planDBProject?: string
}

const DEFAULT_CONFIG: Required<AgentSystemConfig> = {
  openaiCompatibleBaseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL || 'http://localhost:8000/v1',
  apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
  dbPath: process.env.DB_PATH || './data/mastra.db',
  neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || 'password',
  namsApiKey: process.env.NAMS_API_KEY,
  groomCorpus: process.env.GROOM_CORPUS || './wiki',
  planDBProject: process.env.PLANDB_PROJECT || 'default',
}

/**
 * Create the unified Mastra agent system with all three integrations:
 * - PlanDB: Task planning graph with atomic claiming
 * - Neo4j Agent Memory: Relational knowledge graph
 * - GROOM: Self-maintaining wiki
 */
export function createAgentSystem(config: Partial<AgentSystemConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // 1. Storage layer
  const storage = new LibSQLStore({ id: 'storage', url: cfg.dbPath })

  // 2. Observational Memory (OM) — auto memory compression
  const omMemory = new Memory({
    storage,
    options: {
      observationalMemory: {
        model: cfg.openaiCompatibleBaseUrl
          ? 'openai-compatible/vllm-gpt-5-mini'
          : 'openai/gpt-5-mini',
        scope: 'thread' as const,
        observation: {
          messageTokens: 30_000,
          bufferTokens: 0.2,
          bufferActivation: 0.8,
          blockAfter: 1.2,
          previousObserverTokens: 10_000,
          temporalMarkers: true,
          threadTitle: true,
          bufferOnIdle: true,
          activateAfterIdle: 'auto',
          activateOnProviderChange: true,
          manageWorkingMemory: true,
          retrieval: {
            vector: true,
            scope: 'thread',
          },
        },
        reflection: {
          observationTokens: 40_000,
          bufferActivation: 0.5,
          activateAfterIdle: '5m',
        },
      },
    },
  })

  // 3. Neo4j Agent Memory — relational knowledge graph
  //    We configure the extraction pipeline but don't connect to Neo4j at instance level.
  //    Workers get their own MemoryClient instances per-thread.
  const knowledgeMemoryConfig = {
    neo4jUri: cfg.neo4jUri,
    neo4jUser: cfg.neo4jUser,
    neo4jPassword: cfg.neo4jPassword,
    namsApiKey: cfg.namsApiKey,
  }

  // 4. Create agents (with OM injected)
  const { orchestrator, workers } = createAgents({
    memory: omMemory,
    model: cfg.openaiCompatibleBaseUrl
      ? 'openai-compatible/vllm-gpt-5-mini'
      : 'openai/gpt-5-mini',
  })

  // 5. Create tools (PlanDB + Knowledge Graph + Wiki + Herdr + Core)
  const tools = createTools({
    planDBProject: cfg.planDBProject,
    knowledgeMemoryConfig,
    groomCorpus: cfg.groomCorpus,
    openaiCompatibleBaseUrl: cfg.openaiCompatibleBaseUrl,
  })

  // 6. Register GROOM pipeline
  registerGroomPipeline(cfg.groomCorpus)

  // 7. Create workflows (orchestration)
  const workflows = createWorkflows({ orchestrator, workers, tools })

  // 8. Build Mastra instance
  const mastra = new Mastra({
    storage,
    agents: {
      orchestrator,
      ...workers,
    },
    tools,
    workflows,
    memory: omMemory,
    backgroundTasks: {
      enabled: true,
      globalConcurrency: 10,
      perAgentConcurrency: 5,
      backpressure: 'queue',
      defaultTimeoutMs: 300_000,
      onTaskComplete: (task) => {
        // Check if GROOM needs to run after task completion
        // (e.g., if a worker contributed to wiki content)
      },
      onTaskFailed: (task) => {
        // Log failure, notify orchestrator
      },
    },
  })

  return mastra
}

export type AgentSystem = ReturnType<typeof createAgentSystem>
