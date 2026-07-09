/**
 * Master orchestration workflow.
 *
 * Defines the workflow that coordinates all workers:
 * 1. Plan phase (research → implement → review → validate)
 * 2. PlanDB task graph creation
 * 3. Worker dispatch with background tasks
 * 4. Result synthesis
 * 5. Wiki contribution
 */

import { createWorkflow } from '@mastra/core/workflow'

interface OrchestratorConfig {
  orchestrator: any
  workers: Record<string, any>
  tools: Record<string, any>
}

/**
 * Create the master orchestration workflow.
 * This workflow coordinates the full lifecycle:
 * plan → research → implement → review → validate
 */
export function createWorkflows(config: OrchestratorConfig) {
  const { orchestrator, workers, tools } = config

  // ─── Plan Workflow ──────────────────────────────────────────────
  // Orchestrator analyzes the request and creates a PlanDB task graph

  const planWorkflow = createWorkflow({
    id: 'plan-workflow',
    name: 'Task Planning & Dispatch',
    description:
      'Decompose user request into a PlanDB task graph, create PlanDB tasks, and dispatch workers.',
    triggerSchema: null,
    // In production: define the DAG with createNodes, createEdge, etc.
  })

  // ─── Research Workflow ──────────────────────────────────────────
  // Worker researches and contributes findings

  const researchWorkflow = createWorkflow({
    id: 'research-workflow',
    name: 'Research Phase',
    description: 'Researcher gathers information and updates knowledge graph.',
    triggerSchema: null,
  })

  // ─── Implementation Workflow ────────────────────────────────────

  const implementWorkflow = createWorkflow({
    id: 'implement-workflow',
    name: 'Implementation Phase',
    description:
      'Implementer writes code, runs tests, and contributes to wiki.',
    triggerSchema: null,
  })

  // ─── Review Workflow ────────────────────────────────────────────

  const reviewWorkflow = createWorkflow({
    id: 'review-workflow',
    name: 'Review Phase',
    description: 'Reviewer examines work and produces approval report.',
    triggerSchema: null,
  })

  // ─── Validation Workflow ────────────────────────────────────────

  const validateWorkflow = createWorkflow({
    id: 'validate-workflow',
    name: 'Validation Phase',
    description:
      'Validator runs tests, checks acceptance criteria, produces validation report.',
    triggerSchema: null,
  })

  // ─── Monitor Workflow ───────────────────────────────────────────
  // Background workflow that monitors all workers and triggers GROOM

  const monitorWorkflow = createWorkflow({
    id: 'monitor-workflow',
    name: 'System Monitor',
    description:
      'Monitor agent watches worker states, manages layouts, and triggers GROOM maintenance.',
    triggerSchema: null,
  })

  // ─── Orchestrator Workflow (Master) ─────────────────────────────
  // Combines all sub-workflows with orchestration logic

  const orchestratorWorkflow = createWorkflow({
    id: 'orchestrator',
    name: 'Master Orchestrator',
    description:
      'Main orchestrator workflow that coordinates all workers through the full lifecycle.',
    triggerSchema: null,
  })

  return {
    planWorkflow,
    researchWorkflow,
    implementWorkflow,
    reviewWorkflow,
    validateWorkflow,
    monitorWorkflow,
    orchestratorWorkflow,
  }
}
