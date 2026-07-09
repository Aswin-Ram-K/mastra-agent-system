/**
 * Shared Observational Memory configuration factory.
 *
 * Applied to ALL agents — each gets its own Memory instance
 * with thread-scoped isolation.
 */

import { Memory, Extractor } from '@mastra/memory'
import { z } from 'zod'

// ─── Common Extractors (all roles) ──────────────────────────────

const COMMON_EXTRACTIONS = [
  new Extractor({
    name: 'Session context',
    instructions:
      'Extract key context: what is being worked on, current status, blockers.',
    schema: z.object({
      currentTask: z.string().optional(),
      blockers: z.array(z.string()).optional(),
      progress: z.string().optional(),
    }),
  }),
  new Extractor({
    name: 'User preferences',
    instructions:
      'Extract user preferences: coding style, tech stack choices, language.',
    schema: z.object({
      techStack: z.array(z.string()).optional(),
      style: z.string().optional(),
      language: z.string().optional(),
    }),
  }),
]

// ─── Per-Role Extractors ─────────────────────────────────────────

const ROLE_EXTRACTIONS: Record<string, Extractor[]> = {
  orchestrator: [
    new Extractor({
      name: 'Dispatch decisions',
      instructions:
        'Extract dispatch decisions: which workers were used, what tasks were assigned, final output format.',
      schema: z.object({
        workersUsed: z.array(z.string()).optional(),
        tasksAssigned: z.array(z.string()).optional(),
        finalOutputFormat: z.string().optional(),
      }),
    }),
  ],
  researcher: [
    new Extractor({
      name: 'Research findings',
      instructions:
        'Extract what was researched, sources found, quality ratings, conclusions.',
      schema: z.object({
        sources: z.array(
          z.object({
            url: z.string().optional(),
            title: z.string().optional(),
            quality: z.enum(['high', 'medium', 'low']).optional(),
            relevance: z.string().optional(),
          }),
        ),
        conclusions: z.array(z.string()).optional(),
        gaps: z.array(z.string()).optional(),
      }),
    }),
  ],
  planner: [
    new Extractor({
      name: 'Plan structure',
      instructions:
        'Extract task decomposition, dependency graphs, strategy notes.',
      schema: z.object({
        taskGraph: z.array(
          z.object({
            id: z.string(),
            dependsOn: z.array(z.string()),
            estimatedComplexity: z.enum(['simple', 'moderate', 'complex']),
          }),
        ),
        strategy: z.string().optional(),
        discardedApproaches: z.array(z.string()).optional(),
      }),
    }),
  ],
  reviewer: [
    new Extractor({
      name: 'Review results',
      instructions:
        'Extract issues found, severity ratings, review angles applied.',
      schema: z.object({
        issues: z.array(
          z.object({
            description: z.string(),
            severity: z.enum(['critical', 'warning', 'note']),
            category: z.string(),
          }),
        ),
        approval: z.enum(['APPROVED', 'APPROVED_WITH_FIXES', 'REJECTED']),
      }),
    }),
  ],
  implementer: [
    new Extractor({
      name: 'Implementation changes',
      instructions:
        'Extract code changes made, test results, iterations attempted.',
      schema: z.object({
        filesModified: z.array(z.string()).optional(),
        testsWritten: z.array(z.string()).optional(),
        testResults: z.enum(['pass', 'fail', 'mixed']),
        failedApproaches: z.array(z.string()).optional(),
      }),
    }),
  ],
  validator: [
    new Extractor({
      name: 'Validation results',
      instructions:
        'Extract test results, validation criteria, pass/fail summary.',
      schema: z.object({
        testsPassed: z.number().optional(),
        testsFailed: z.number().optional(),
        coverage: z.number().optional(),
        criteria: z.record(
          z.object({
            status: z.enum(['PASS', 'FAIL', 'NA']),
            details: z.string().optional(),
          }),
        ),
      }),
    }),
  ],
  monitor: [
    new Extractor({
      name: 'System events',
      instructions:
        'Extract agent states, layout changes, event summary, anomalies.',
      schema: z.object({
        agentStates: z.record(
          z.object({
            state: z.string(),
            duration: z.string().optional(),
          }),
        ),
        anomalies: z.array(z.string()).optional(),
      }),
    }),
  ],
}

// ─── Memory Config Factory ───────────────────────────────────────

export interface MemoryConfig {
  openaiCompatibleBaseUrl?: string
  apiKey?: string
}

/**
 * Create a Memory instance with Observational Memory enabled.
 * Role-specific extractors are added on top of common ones.
 */
export function createAgentMemory(
  role: string,
  config: MemoryConfig = {},
): Memory {
  const model = config.openaiCompatibleBaseUrl
    ? 'openai-compatible/vllm-gpt-5-mini'
    : 'openai/gpt-5-mini'

  const roleExtractors = ROLE_EXTRACTIONS[role] || []
  const allExtractors = [...COMMON_EXTRACTIONS, ...roleExtractors]

  return new Memory({
    storage: {
      // LibSQLStore will be provided at Mastra instance level
      id: 'memory',
    } as any,
    options: {
      observationalMemory: {
        model,
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
          extraction: allExtractors,
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
}

/**
 * Get role-specific extractors for GROOM wiki integration.
 */
export function getRoleExtractorsForWiki(role: string): Extractor[] {
  return [
    new Extractor({
      name: `${role} wiki contribution`,
      instructions: `Extract actionable knowledge from this ${role} session that should be persisted to the wiki: new patterns discovered, tools used, decisions made, errors encountered.`,
      schema: z.object({
        knowledge: z.array(
          z.object({
            topic: z.string(),
            content: z.string(),
            category: z.enum(['pattern', 'decision', 'error', 'tool']),
          }),
        ),
      }),
    }),
  ]
}
