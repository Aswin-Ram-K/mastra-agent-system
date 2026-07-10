# Mastra + Herdr Agent System — Architecture

**Status:** DRAFT — Pending Approval  
**Date:** 2026-07-09  
**Version:** 0.1

---

## 0. System Overview

A stack-agnostic, skill-driven orchestrator system that:

- Breaks tasks into subtasks and dispatches them to worker agents
- Each worker has a fixed base role (reviewer, implementer, validator, researcher, planner, monitor) but gets customized per run with specific skills, tools, and MCPs from a live library
- Workers run inside **Herdr terminal panes** with full visibility — the orchestrator and user see all agent states in real-time via Herdr's sidebar
- The orchestrator uses Mastra's **AgentController** for mode-based session management (plan → research → implement → review → validate), **Signals** for state communication, and **Background Tasks** for non-blocking worker execution
- Everything speaks through an **OpenAI-compatible endpoint** (vLLM on local network) as the default provider

- **PlanDB** — Task planning graph with atomic claiming, critical path analysis, and BM25 context surfacing
- **Neo4j Agent Memory** — Relational knowledge graph for entities, relationships, and reasoning traces
- **GROOM** — Self-maintaining wiki with background maintenance (lint, prune, expand, research, iterate)

### Key Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Agent visibility first** | Herdr sidebar shows all agent states; no hidden workers |
| **Stack-agnostic** | No hardcoded dependencies on specific frameworks; tools/MCPs are dynamic |
| **Per-run customization** | Each run curates its own worker toolsets from the registry |
| **Iterative streaming** | Orchestrator loop continues until idle; workers report state continuously |
| **Declarative layouts** | Herdr layouts saved as BSP trees; presets per workflow type |

---

## 1. Architecture Components

### 1.1. Agent Hierarchy (Agent Pins)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟣 ORCHESTRATOR (Mastra AgentController + Supervisor)           │
│   - Breaks tasks into subtasks                                 │
│   - Dispatches to workers with curated toolsets                │
│   - Manages Herdr workspace/tab/pane layout                    │
│   - Subscribes to Herdr agent status events                    │
│   - Manages library registry (skills, tools, MCPs)             │
│   - Runs inside a dedicated Herdr pane (w1:p1)                 │
└──────────────────┬──────────────────────────────────────────────┘
                   │  dispatches workers via Mastra agents
                   │  each worker gets its own Herdr pane
                   ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ 🔵     │ │ 🟡     │ │ 🔴     │ │ 🟢     │ │ 🟠     │ │ 🔘     │
│ RES    │ │ PLAN   │ │ REVI   │ │ IMPLE  │ │ VALID  │ │ MONIT  │
│ ARCHER │ │ NNER   │ │ EWER   │ │ MENTER │ │ ATOR   │ │ OR     │
│        │ │        │ │        │ │        │ │        │ │        │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### 1.2. Library Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 CENTRAL LIBRARY REGISTRY                                     │
│   - skills/     (skill definitions with metadata)               │
│   - tools/      (custom tool definitions, input/output schemas)  │
│   - mcp/        (MCP server configurations — URL, command, auth)│
│   - layouts/    (Herdr BSP tree layout presets)                  │
│   - protocols/  (signal schemas, approval policies)             │
└────────────────────────┬────────────────────────────────────────┘
                         │  auto-discovers + manual registration
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 🔄 AUTO-DISCOVERY ENGINE                                        │
│   - Scans skills/ for new skill files                           │
│   - Scans tools/ for new tool definitions                       │
│   - Queries MCP registries (Klavis, Smithery, etc.)             │
│   - Builds dynamic toolsets per-request                         │
│   - Exposes through MCP Client's listToolsets()                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3. Herdr Integration Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟤 HERDR INTEGRATION MANAGER                                    │
│   - Creates workspaces per project                              │
│   - Manages tabs (agents, server, logs, history)                │
│   - Splits panes for each worker agent                          │
│   - Reports agent states via pane.report_agent()                │
│   - Subscribes to Herdr events via events.subscribe()           │
│   - Applies layout presets via layout.apply()                   │
│   - Moves panes dynamically via pane.move()                     │
│   - Watches for blocked agents via wait agent-status            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4. Observational Memory Layer

Every agent gets Mastra's **Observational Memory** (OM) — a long-term memory system that automatically compresses conversation history into dense observations, preventing context rot and enabling cross-session continuity.

#### How OM Works (3-Tier System)

```
┌──────────────────────────────────────────────────────────────────┐
│ TIER 1: Recent Messages — exact conversation history             │
│         (kept for current task, grows until messageTokens threshold) │
├──────────────────────────────────────────────────────────────────┤
│ TIER 2: Observations — compressed log of what happened           │
│         Observer runs at messageTokens threshold (default: 30k)  │
│         5–40× compression, emoji-prioritized log format          │
├──────────────────────────────────────────────────────────────────┤
│ TIER 3: Reflections — condensed patterns from observations       │
│         Reflector runs when observations hit observationTokens   │
│         (default: 40k) — garbage collects, combines related items │
└──────────────────────────────────────────────────────────────────┘
```

#### Worker Memory Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PER-AGENT MEMORY ISOLATION                        │
│                                                                      │
│  Orchestrator        Researcher        Implementer        Monitor   │
│  ───────────         ──────────        ───────────        ─────────  │
│  Thread: main        Thread: main      Thread: main      Thread: mon │
│  ┌──────────┐        ┌──────────┐      ┌──────────┐      ┌────────┐ │
│  │Messages  │        │Messages  │      │Messages  │      │Messages│ │
│  │~25k tok  │        │~25k tok  │      │~25k tok  │      │~25k tok│ │
│  └────┬─────┘        └────┬─────┘      └────┬─────┘      └───┬────┘ │
│  ┌───▼─────┐        ┌───▼─────┐      ┌───▼─────┐      ┌───▼────┐ │
│  │Obs. Log │        │Obs. Log │      │Obs. Log │      │Obs.Log│ │
│  │10k tok  │        │10k tok  │      │10k tok  │      │10k tok│ │
│  └────┬────┘        └────┬────┘      └────┬────┘      └───┬────┘ │
│  ┌───▼─────┐        ┌───▼─────┐      ┌───▼─────┐      ┌───▼────┐ │
│  │Reflections│     │Reflections│   │Reflections│   │Reflections│ │
│  │5k tok   │        │5k tok   │      │5k tok   │      │5k tok  │ │
│  └──────────┘        └──────────┘      └──────────┘      └────────┘ │
└─────────────────────────────────────────────────────────────────────┘
  Each thread isolated, no cross-contamination (thread scope)
```

#### Per-Agent Memory Configuration

```typescript
// Shared memory factory — one config applied to all agents
function createAgentMemory(config?: Partial<ObservationalMemoryConfig>) {
  return new Memory({
    storage: new LibSQLStore({ url: 'file:./memory.db' }),
    options: {
      observationalMemory: {
        // Model — use OpenAI-compatible endpoint (vLLM)
        model: 'openai-compatible/vllm-gpt-5-mini',
        // Thread scope: each agent/thread isolated
        scope: 'thread',

        // Observer: compresses message history into observations
        observation: {
          messageTokens: 30_000,              // trigger at 30k tokens
          bufferTokens: 0.2,                  // buffer every 20%
          bufferActivation: 0.8,              // keep 20% history on activation
          blockAfter: 1.2,                     // safety: force sync at 36k
          previousObserverTokens: 10_000,     // only 10k prior obs to Observer
          temporalMarkers: true,              // gap markers for resumed sessions
          threadTitle: true,                  // auto-generate thread titles
          bufferOnIdle: true,                 // buffer when agent goes idle
          activateAfterIdle: 'auto',          // activate before cache expires
          activateOnProviderChange: true,     // activate when model changes
          manageWorkingMemory: true,          // auto-manage working memory
          extraction: [
            // ── Common extractors for all workers ──
            new Extractor({
              name: 'Session context',
              instructions: 'Extract key context: what is being worked on, current status, blockers.',
              schema: z.object({
                currentTask: z.string().optional(),
                blockers: z.array(z.string()).optional(),
                progress: z.string().optional(),
              }),
            }),
            new Extractor({
              name: 'User preferences',
              instructions: 'Extract user preferences: coding style, tech stack choices, language.',
              schema: z.object({
                techStack: z.array(z.string()).optional(),
                style: z.string().optional(),
                language: z.string().optional(),
              }),
            }),
          ],
          retrieval: {
            vector: true,                     // semantic search enabled
            scope: 'thread',                  // current thread only
          },
        },

        // Reflector: compresses observations into patterns
        reflection: {
          observationTokens: 40_000,         // trigger at 40k obs tokens
          bufferActivation: 0.5,             // start at 50%
          activateAfterIdle: '5m',           // activate after 5 min idle
        },
      },
    },
  })
}
```

#### Per-Role Memory Customization

While all workers share the base memory config, each role gets **role-specific extractors**:

| Role | Extractors | Purpose |
|------|-----------|---------|
| **🟣 Orchestrator** | Session context, dispatch decisions, final state | Remember project scope, workflow decisions, final output format |
| **🔵 Researcher** | Searched sources, findings, source quality ratings | Remember what was researched, what was found, what was ruled out |
| **🟡 Planner** | Task decomposition, dependency graphs, strategy notes | Remember plan iterations, approved strategies, discarded approaches |
| **🔴 Reviewer** | Issues found, severity ratings, review angles applied | Remember review history, common defect patterns, approval criteria |
| **🟢 Implementer** | Code changes made, test results, iterations attempted | Remember code decisions, failed approaches, working patterns |
| **🟠 Validator** | Test results, validation criteria, pass/fail summary | Remember test coverage, edge cases tested, known failures |
| **🔘 Monitor** | Agent states, layout changes, event summary | Remember worker lifecycle events, layout history, anomalies |

#### Memory Behavior Matrix

| Feature | How It Helps Workers | Worker Impact |
|---------|---------------------|---------------|
| **Async buffering** | Observer pre-computes in background every 20% of threshold | Workers never pause mid-execution for memory management |
| **5–40× compression** | Raw messages compressed into dense emoji-prioritized log | Workers carry only relevant context, no context rot |
| **Temporal gap markers** | Inserts reminder when 10+ min gap between messages | Workers resuming after hours/days know what happened since |
| **Thread title auto-gen** | Observer suggests title when topic meaningfully changes | Workers stay oriented on multi-topic sessions |
| **Extractor pipeline** | Custom facts extracted alongside observations | Workers automatically capture project structure, user preferences, coding patterns |
| **Semantic recall** | Vector search across all past observations | Workers can find past work semantically, not just by keyword |
| **Working memory auto-mgmt** | Observer manages working memory via state signals | No worker needs to manually "remember" anything |
| **Early activation** | Activates buffered obs on idle or provider change | Prompt cache stays useful — compressed context sent on next request |
| **Resource scope** (experimental) | Shared observations across all threads for a user | Enables cross-project learning for a user (opt-in per-agent) |

#### Memory Integration With Herdr

The Herdr integration layer surfaces OM health metrics in the sidebar:

```bash
# Monitor pane can surface memory health via Herdr events:
#   - Token usage bars (messages → observation threshold proximity)
#   - Recent extraction results
#   - Active observation/reflection status

# Via Herdr pane reporting (Monitors this):
herdr pane report-agent <monitor-pane> \
  --source custom:memory-health \
  --agent memory-monitor \
  --state working \
  --custom-status "memory: 15k/30k obs | 2k/40k ref | 0 gaps"
```

### 1.6. Knowledge Base Integration Layer

Three complementary knowledge systems give agents planning structure, relational reasoning, and self-maintaining memory:

```
┌─────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE BASE LAYER                                                │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │  PlanDB       │  │  Neo4j Agent     │  │  GROOM Wiki       │      │
│  │  Task Graph   │  │  Memory          │  │  Self-Maint. KB   │      │
│  │              │  │                  │  │                  │      │
│  │ • Tasks      │  │ • Entities       │  │ • Patterns      │      │
│  │ • Deps       │  │ • Relationships  │  │ • Decisions     │      │
│  │ • Claiming   │  │ • Reasoning      │  │ • Errors        │      │
│  │ • Critical   │  │ • Preferences    │  │ • Tools         │      │
│  │   Path       │  │ • Facts          │  │ • Glossary      │      │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬─────────┘      │
│         │                    │                       │               │
│         ▼                    ▼                       ▼               │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Workers use ALL three simultaneously:                   │        │
│  │                                                          │        │
│  │  1. PlanDB:  "What should I work on?" → claim task       │        │
│  │  2. Neo4j:  "What do I already know?" → query graph     │        │
│  │  3. Wiki:   "What have others learned?" → read wiki     │        │
│  │     AND: "What did I learn?" → contribute to wiki       │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

#### PlanDB — Task Planning Graph

| Feature | Integration | Worker Usage |
|---------|-------------|--------------|
| `plandb_add` | Add tasks with deps, kinds, pre/post conditions | Orchestrator creates tasks, Planner decomposes |
| `plandb_go` | Atomic claiming — only one worker claims per task | All workers claim next available work |
| `plandb_done` | Complete task + unblock dependencies | Workers signal completion |
| `plandb_critical_path` | Longest dependency chain analysis | Orchestrator optimizes dispatch order |
| `plandb_bottlenecks` | Tasks blocking most downstream work | Orchestrator prioritizes blockers |
| `plandb_context` | BM25-searchable context entries | Workers record discoveries, blockers |

#### Neo4j Agent Memory — Relational Knowledge Graph

| Feature | Integration | Worker Usage |
|---------|-------------|--------------|
| Entity extraction | spaCy/GLiNER/LLM pipeline | Researchers extract entities automatically |
| Relationship extraction | GLiREL pipeline | Workers build entity connections |
| Entity deduplication | Built-in resolution | No duplicate entities across sessions |
| Reasoning traces | `:TOUCHED` audit edges | Workers document why decisions were made |
| Multi-tenant scoping | `user_identifier` per user | Isolated per-user graphs |
| MCP server | 16 query tools exposed | Any worker queries via MCP |

#### GROOM — Self-Maintaining Wiki

| Feature | Integration | Worker Usage |
|---------|-------------|--------------|
| Wiki query | BM25 search across markdown pages | Workers read before/after work |
| Wiki contribute | Markdown file creation/append | Workers add patterns, decisions, errors |
| GROOM lint | Fix frontmatter, links, style drift | Monitor triggers on schedule |
| GROOM prune | Remove duplication, merge overlap | Monitor triggers on schedule |
| GROOM expand | Web-research what changed | Monitor triggers on schedule |
| GROOM iterate | Improve weakest page | Monitor triggers on schedule |

#### Knowledge Flow Diagram

```
  Worker completes task
        │
        ├─→ plandb_done → next task unlocked
        │
        ├─→ Knowledge Graph:                          
        │    MemoryClient.long_term.addEntity({       
        │      name: "AuthController",                
        │      type: "COMPONENT",                     
        │      properties: { framework: "Express" }   
        │    })                                       
        │
        ├─→ GROOM Wiki:                               
        │    wiki_contribute({                        
        │      topic: "Auth pattern",                 
        │      content: "Use JWT with refresh tokens"  
        │    })                                       
        │
        └─→ PlanDB context:
             plandb_context("Remember: JWT + refresh tokens")
```

### 1.7. Communication Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ 📡 SIGNALS ARCHITECTURE                                          │
│                                                                   │
│  Worker Agent              Mastra Thread              Herdr       │
│  ──────────              ──────────────              ─────       │
│  sendSignal()  ───────→  sendMessage() ────┐        │             │
│  sendStateSignal()───→  sendStateSignal() ─┤        │             │
│  sendNotificationSignal() ──→ inbox ───────┤  SSE     │             │
│                                              └────────┤  Event      │
│  readStateSignal() ←── get thread ────────┤  Stream    │             │
│                                              └────────┼─────────────┘
│                                                  read via pane.read()
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Mastra Integration

### 2.1. AgentController (Not Hand-Rolled)

Instead of building a custom orchestrator loop, we use **Mastra's AgentController** which provides:

| Capability | How We Use It |
|------------|---------------|
| **Modes** | `plan` → `research` → `implement` → `review` → `validate` — each mode has its own instructions, tools, and model |
| **Threads** | Per-project persistent threads that survive restarts, carrying mode state and conversation history |
| **Subagents** | Worker agents spawned as constrained subagents with specific tool sets |
| **Tool Approvals** | Human-in-the-loop gating for file writes, deployments, and other risky actions |
| **Event System** | Typed events (`message_update`, `mode_change`, `tool_approval_required`) drive the UI and Herdr integration |
| **Observational Memory** | Auto-summarization across threads for long-running sessions — see §1.4 |

```typescript
// AgentController configuration
const agentController = new AgentController({
  id: 'orchestrator',
  agent: orchestratorAgent,
  storage: new LibSQLStore({ url: 'file:./data.db' }),
  modes: [
    { id: 'plan', name: 'Plan', metadata: { default: true }, instructions: '...' },
    { id: 'research', name: 'Research', instructions: '...' },
    { id: 'implement', name: 'Implement', instructions: '...' },
    { id: 'review', name: 'Review', instructions: '...' },
    { id: 'validate', name: 'Validate', instructions: '...' },
  ],
  notifications: {
    deliveryPolicy: { priority: 'high' } // urgent notifications immediate
  }
})
```

### 2.2. Signals Protocol

We use three signal types for agent-to-agent communication:

| Signal Type | Producer | Consumer | Purpose |
|-------------|----------|----------|---------|
| **Message** (`sendMessage`) | User / External UI | Orchestrator | User requests, follow-ups, clarifications |
| **State** (`sendStateSignal`) | Worker Agent | Orchestrator | Worker progress, output state, errors |
| **Notification** (`sendNotificationSignal`) | External (CI, GitHub, Slack) | Orchestrator inbox | Alerts, failures, status changes |
| **Reactive** (from Processor) | Orchestrator Processor | Worker Agent | Context injection, policy reminders |

#### State Signal Schema

```typescript
// Worker → Orchestrator state updates
interface WorkerStateSignal {
  id: 'worker-status';
  mode: 'snapshot' | 'delta';
  cacheKey: string;
  contents: string;    // Human-readable status for the model
  value: {
    agentId: string;
    phase: 'running' | 'blocked' | 'done' | 'error';
    output?: string;
    error?: string;
    taskId?: string;
  };
}
```

#### Signal Delivery Policy

| Signal | ifActive | ifIdle |
|--------|----------|--------|
| Worker state (snapshot) | Inject into current agentic loop | Store for next turn |
| Worker state (delta) | Inject as reactive signal | Store for next turn |
| Error notification | Immediate interruption | Persist to inbox |
| Success notification | Append to memory | Persist to inbox |

### 2.3. Background Tasks Lifecycle

Workers are dispatched as background tasks — the orchestrator stream never blocks.

```
┌─────────────────────────────────────────────────────────────────┐
│                    BACKGROUND TASK FLOW                          │
│                                                                  │
│  Orchestrator agent.stream({ untilIdle: true })                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Orchestrator calls a worker subagent                  │   │
│  │    → Background task dispatched (taskId: abc123)         │   │
│  │    → LLM continues responding immediately                 │   │
│  │    → Task runs to completion in background                │   │
│  │                                                           │   │
│  │ 2. Task completes                                         │   │
│  │    → Result written to memory                             │   │
│  │    → Orchestrator auto-re-invoked (untilIdle)             │   │
│  │    → Orchestrator sees result and dispatches next worker  │   │
│  │                                                           │   │
│  │ 3. Task suspends (e.g., needs human approval)             │   │
│  │    → Status: suspended, persists to storage               │   │
│  │    → Releases concurrency slot                            │   │
│  │    → Orchestrator gets notification                       │   │
│  │    → On resume: task restarts with resumeData             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### Configuration

```typescript
// Mastra instance — background tasks enabled
const mastra = new Mastra({
  storage: new LibSQLStore({ id: 'storage', url: 'file:mastra.db' }),
  backgroundTasks: {
    enabled: true,
    globalConcurrency: 10,
    perAgentConcurrency: 5,
    backpressure: 'queue',
    defaultTimeoutMs: 300_000,  // 5 min default
    onTaskComplete: (task) => { /* log, Herdr notification */ },
    onTaskFailed: (task) => { /* log, signal orchestrator */ },
  },
  // Redis pubsub for distributed deployments
  pubsub: new RedisStreamsPubSub({ url: process.env.REDIS_URL }),
})
```

#### Tool-Level Background Configuration

```typescript
// Each worker tool can opt into background execution
const implementTool = createTool({
  id: 'implement',
  description: 'Implement code changes',
  inputSchema: z.object({ ... }),
  background: {
    enabled: true,
    timeoutMs: 600_000,  // 10 min for complex changes
    maxRetries: 1,
  },
  execute: async ({ inputData }) => { ... },
})
```

---

## 3. Herdr Integration

### 3.1. Pane Architecture

Every agent gets its own Herdr pane. The orchestrator pane manages layout.

```
Workspace: "project-name"
├── Tab: "agents" (main workspace, default)
│   ├── Pane 1 (w1:p1): ORCHESTRATOR — Mastra agent loop
│   ├── Pane 2 (w1:p2): 🔵 RESEARCHER — Worker agent
│   ├── Pane 3 (w1:p3): 🟡 PLANNER — Worker agent
│   ├── Pane 4 (w1:p4): 🔴 REVIEWER — Worker agent
│   ├── Pane 5 (w1:p5): 🟢 IMPLEMENTER — Worker agent
│   └── Pane 6 (w1:p6): 🟠 VALIDATOR — Worker agent
│
├── Tab: "server" (dev server, logs)
│   └── Pane 1 (w1:t2:p1): npm run dev / server output
│
├── Tab: "logs" (consolidated worker output)
│   ├── Pane 1 (w1:t3:p1): orchestrator consolidated log
│   └── Pane 2 (w1:t3:p2): individual worker logs feed
│
└── Tab: "history" (completed workers, results)
    └── Panes: completed worker output archives
```

### 3.2. Declarative Layout Presets (BSP Trees)

Each workflow type has a saved layout preset that gets restored instantly via `layout.apply()`.

#### Research Layout Preset

```json
{
  "workspace_id": "w1",
  "tab_label": "agents",
  "focus": true,
  "root": {
    "type": "split",
    "direction": "right",
    "ratio": 0.3,
    "first": {
      "type": "pane",
      "label": "orchestrator",
      "cwd": "/project",
      "command": ["sh", "-c", "herdr-agent orchestrator"]
    },
    "second": {
      "type": "split",
      "direction": "down",
      "ratio": 0.5,
      "first": {
        "type": "pane",
        "label": "researcher",
        "cwd": "/project",
        "command": ["sh", "-c", "herdr-agent researcher"]
      },
      "second": {
        "type": "pane",
        "label": "planner",
        "cwd": "/project",
        "command": ["sh", "-c", "herdr-agent planner"]
      }
    }
  }
}
```

#### Implementation Layout Preset

```json
{
  "workspace_id": "w1",
  "tab_label": "agents",
  "focus": true,
  "root": {
    "type": "split",
    "direction": "right",
    "ratio": 0.4,
    "first": {
      "type": "pane",
      "label": "orchestrator",
      "cwd": "/project"
    },
    "second": {
      "type": "split",
      "direction": "down",
      "ratio": 0.5,
      "first": {
        "type": "pane",
        "label": "implementer",
        "cwd": "/project",
        "command": ["sh", "-c", "herdr-agent implementer"]
      },
      "second": {
        "type": "pane",
        "label": "validator",
        "cwd": "/project",
        "command": ["sh", "-c", "herdr-agent validator"]
      }
    }
  }
}
```

#### Multi-Agent Layout Preset (All Workers)

```json
{
  "workspace_id": "w1",
  "tab_label": "agents",
  "focus": true,
  "root": {
    "type": "split",
    "direction": "right",
    "ratio": 0.25,
    "first": {
      "type": "pane",
      "label": "orchestrator",
      "cwd": "/project"
    },
    "second": {
      "type": "split",
      "direction": "down",
      "ratio": 0.5,
      "first": {
        "type": "split",
        "direction": "right",
        "ratio": 0.5,
        "first": { "type": "pane", "label": "researcher", "cwd": "/project" },
        "second": { "type": "pane", "label": "planner", "cwd": "/project" }
      },
      "second": {
        "type": "split",
        "direction": "right",
        "ratio": 0.5,
        "first": { "type": "pane", "label": "reviewer", "cwd": "/project" },
        "second": { "type": "pane", "label": "implementer", "cwd": "/project" }
      }
    }
  }
}
```

### 3.3. Agent State Bridge

Each worker pane reports its Mastra agent state to Herdr so the sidebar reflects real progress.

```typescript
// Inside each worker pane's shell/agent
// Herdr injects HERDR_PANE_ID, HERDR_TAB_ID, HERDR_WORKSPACE_ID

// Worker reports to Herdr:
herdr agent start <role> \
  --pane <pane_id> \
  --label "<role-display>" \
  --workspace <workspace_id>

// Herdr auto-detects the agent in the pane.
// If the agent is a Mastra agent, we also report state explicitly:

// Pane reports agent state to Herdr sidebar:
// CLI wrapper (called from within the agent):
herdr pane report-agent <pane_id> \
  --source custom:orchestrator \
  --agent <agent-role> \
  --state <working|blocked|idle|done> \
  --custom-status <activity-label>
```

### 3.4. Event Subscription Flow

The orchestrator subscribes to Herdr events for reactive orchestration.

```bash
# Orchestrator pane subscribes to agent status changes:
# Via raw socket API:
#   method: "events.subscribe"
#   subscriptions: [
#     { type: "pane.agent_status_changed", pane_id: "*" },
#     { type: "pane.output_matched", pane_id: "*" }
#   ]

# When a worker goes "blocked", orchestrator receives event and:
# 1. Reads the blocked pane's output to understand why
# 2. Decides whether to intervene or wait
# 3. If intervention needed: sends input to pane or routes to another worker
```

### 3.5. Herdr CLI Command Checklist (Orchestrator Snippets)

These are reusable command snippets the orchestrator agent uses to control Herdr:

#### Pane Management

```bash
# Discover own pane and neighbors
herdr pane list
herdr tab list --workspace <wid>

# Create new worker pane (split right, no focus)
NEW_PANE=$(herdr pane split <pane_id> --direction right --no-focus \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "<command-to-start-agent>"

# Read worker output
herdr pane read <pane_id> --source recent --lines 50

# Send input to worker
herdr pane run <pane_id> "<instruction>"
```

#### Agent Management

```bash
# Start agent in pane (auto-detects)
herdr agent start <role> --pane <pane_id> --workspace <wid> --label "<role-name>"

# Wait for worker to complete
herdr wait agent-status <pane_id> --status done --timeout 300000

# Wait for specific output
herdr wait output <pane_id> --match "READY" --regex --timeout 30000

# Rename agent display
herdr agent rename <pane_id> "<role>: active"
```

#### Layout Management

```bash
# Apply layout preset
# (via socket API — layout.apply with BSP tree)

# Export current layout for saving
herdr api snapshot > layout-snapshot.json

# Zoom a worker pane for focus
herdr pane zoom <pane_id> --on
herdr pane zoom <pane_id> --off

# Swap panes
herdr pane swap <pane_id> --direction right

# Move pane to history tab
herdr pane move <pane_id> \
  --destination "tab:<tab_id>" \
  --split right \
  --focus
```

#### Workspace Management

```bash
# Create workspace for project
herdr workspace create --cwd /project/path --label "project-name"

# Create worktree checkout
herdr worktree create --workspace <wid> --branch "feature/xyz"

# Focus workspace
herdr workspace focus <wid>
```

---

## 4. Worker Agent Definitions

### 4.1. Fixed Base Roles (With Per-Run Customization)

| Role | Base Instructions | Default Tools | Default Model | Herdr Pane | Memory Config |
|------|-------------------|---------------|---------------|------------|---------------|
| **🟣 Orchestrator** | Coordinate workers, make dispatch decisions, synthesize results | AgentController, Signals, Herdr CLI tools | Strong model (reasoning) | w1:p1 (always present) | Session context, dispatch decisions |
| **🔵 Researcher** | Gather info, search, analyze sources, build context | Web search, file read, code search | Balanced model | w1:p2 (on demand) | Searched sources, findings, ratings |
| **🟡 Planner** | Decompose tasks, analyze dependencies, create strategy | File tree, code analysis, dependency graph | Balanced model | w1:p3 (on demand) | Task decomposition, dependency graphs |
| **🔴 Reviewer** | Review code from multiple angles (correctness, tests, security, performance) | File read, code search, diff analysis | Strong model | w1:p4 (on demand) | Issues found, severity ratings |
| **🟢 Implementer** | Write/modify code, run tests, execute scripts | File write, bash execution, tool calling | Balanced model | w1:p5 (on demand) | Code changes, test results, iterations |
| **🟠 Validator** | Run tests, validate output, check acceptance criteria | Test runner, file read, output validation | Fast model | w1:t2:p1 (on demand) | Test results, validation criteria |
| **🔘 Monitor** | Watch worker states, manage Herdr layout, handle re-routing | Herdr CLI, pane read, agent status | Fast model | w1:t2:p2 (always present) | Agent states, layout changes, events |

### 4.2. Per-Run Customization

Each run, the Orchestrator curates a **toolset** for each worker:

```typescript
// The Orchestrator decides what tools each worker gets
interface WorkerToolset {
  agentId: string;      // Which base role
  tools: string[];      // Specific tool IDs from the registry
  mcpServers?: string[]; // Which MCP servers to connect
  model?: string;       // Override default model
  maxSteps?: number;    // Max agentic steps
  backgroundTimeout?: number;  // Background task timeout
}

// Example: Research task → Researcher gets search tools + docs MCP
// Example: Coding task → Implementer gets file write + test runner + bash
// Example: Security audit → Reviewer gets security-specific tools + CVE DB MCP
```

---



### 4.3. Detailed Role Specifications

Each worker role has a specific lifecycle, responsibilities, and quality criteria.

#### 🟣 Orchestrator

```typescript
interface OrchestratorRole {
  // Primary responsibility
  role: "orchestrator";

  // Workflow
  lifecycle: [
    "receive_task",           // Accept task from user
    "plan_decompose",         // Break into subtasks (PlanDB)
    "dispatch_workers",       // Spawn workers with tools
    "monitor_progress",       // Watch worker states
    "synthesize_results",     // Combine worker outputs
    "deliver_response",       // Send final response
  ];

  // Key decisions to make
  decisions: [
    "Which phase to enter?",         // plan | research | implement | review | validate
    "Which workers to spawn?",       // Based on task type
    "What tools to give each worker?"// Based on worker role + task context
    "When to escalate to human?",   // After 3+ retries
    "What approach to take?",       // Direct answer vs. multi-step workflow
  ];

  // Output format
  output: {
    status: string;                 // working | blocked | done | error
    phase: string;                  // Current workflow phase
    tasks: TaskSummary[];           // Task list with status
    workers: WorkerSummary[];       // Active workers
    nextAction?: string;            // What to do next
  };
}
```

#### 🔵 Researcher

```typescript
interface ResearcherRole {
  role: "researcher";

  // Workflow
  lifecycle: [
    "receive_handoff",              // Get task context from orchestrator
    "identify_sources",             // Determine what to research
    "execute_research",             // Web search, file read, code analysis
    "synthesize_findings",          // Combine sources into insights
    "report_results",               // Send findings back to orchestrator
  ];

  // Research strategies
  strategies: [
    "Code search → AST-aware structural search",
    "Web search → Find documentation, tutorials, examples",
    "File read → Understand existing codebase",
    "MCP query → Use specialized MCP tools",
  ];

  // Quality criteria
  quality: {
    sources: number;                // Min 3 sources
    confidence: number;             // Min 0.7 confidence
    coverage: string;               // All aspects of question covered?
    relevance: string;              // Findings directly address task?
  };
}
```

#### 🟡 Planner

```typescript
interface PlannerRole {
  role: "planner";

  // Workflow
  lifecycle: [
    "receive_research",             // Get researcher's findings
    "decompose_task",               // Break into atomic tasks
    "analyze_dependencies",         // Map task dependencies
    "prioritize_tasks",             // Critical path analysis
    "create_strategy",              // Implementation approach
    "submit_plan",                  // Send plan to orchestrator for approval
  ];

  // Task decomposition rules
  rules: [
    "Each task is atomic (one clear deliverable)",
    "Tasks have clear dependencies (topologically sorted)",
    "Tasks are estimated (simple, medium, complex)",
    "Tasks include pre/post conditions",
    "Tasks include expected output format",
  ];

  // Output format
  output: {
    tasks: TaskNode[];              // Task graph
    dependencies: DependencyMap;    // Task → dependencies
    strategy: string;               // Implementation approach
    estimated_steps: number;        // Expected total steps
    risk_factors: string[];         // Potential issues
  };
}
```

#### 🔴 Reviewer

```typescript
interface ReviewerRole {
  role: "reviewer";

  // Workflow
  lifecycle: [
    "receive_code",                 // Get code changes from implementer
    "run_review",                   // Multi-angle review
    "categorize_issues",            // Group and prioritize issues
    "generate_report",              // Structured review report
    "send_feedback",                // Send back to implementer or approve
  ];

  // Review angles
  angles: [
    { name: "correctness", priority: "critical" },     // Does it work?
    { name: "tests", priority: "critical" },           // Are tests adequate?
    { name: "security", priority: "high" },            // Security vulnerabilities?
    { name: "performance", priority: "medium" },       // Performance concerns?
    { name: "readability", priority: "medium" },       // Code quality?
    { name: "architecture", priority: "medium" },      // Fits project structure?
    { name: "edge_cases", priority: "high" },          // Edge cases handled?
  ];

  // Issue severity levels
  severity: {
    critical: "Must fix before merge",     // Blocks implementation
    high: "Should fix soon",               // Significant issue
    medium: "Nice to fix",                 // Important but not blocking
    low: "Optional",                       // Minor improvement
  };
}
```

#### 🟢 Implementer

```typescript
interface ImplementerRole {
  role: "implementer";

  // Workflow
  lifecycle: [
    "receive_task",               // Get task + context from planner
    "analyze_requirements",       // Understand what needs to be done
    "plan_implementation",        // Plan approach (briefly)
    "write_code",                 // Create/modify files
    "run_tests",                  // Execute relevant tests
    "self_review",                // Review own changes
    "report_completion",          // Send to reviewer/validator
  ];

  // Code quality rules
  rules: [
    "Follow existing project style",
    "Use established patterns",
    "Add comments for complex logic",
    "Write/modify tests alongside code",
    "Never delete untested code without backup",
    "Log significant decisions in PlanDB context",
  ];

  // Output format
  output: {
    files_changed: FileChange[];  // List of modified files
    tests_run: string;            // Test commands executed
    tests_pass: boolean;          // Did tests pass?
    decisions_made: string;       // Key decisions
    notes: string;                // Additional notes
  };
}
```

#### 🟠 Validator

```typescript
interface ValidatorRole {
  role: "validator";

  // Workflow
  lifecycle: [
    "receive_implementation",     // Get implementation from implementer
    "run_tests",                  // Execute full test suite
    "check_acceptance",           // Verify acceptance criteria
    "validate_output",            // Check output format/content
    "report_results",             // Pass/fail with details
  ];

  // Validation criteria
  criteria: {
    tests_pass: boolean;          // All tests pass?
    output_matches: boolean;      // Output matches expected format?
    edge_cases_covered: boolean;  // Edge cases tested?
    no_regression: boolean;       // Existing tests still pass?
    performance_acceptable: boolean; // Within performance budget?
  };
}
```

#### 🔘 Monitor

```typescript
interface MonitorRole {
  role: "monitor";

  // Workflow
  lifecycle: [
    "observe_worker_states",      // Watch all worker panes
    "detect_anomalies",           // Identify issues
    "manage_layout",              // Adjust Herdr layout as needed
    "report_status",              // Send status to orchestrator
    "trigger_recovery",           // Activate self-healing if needed
  ];

  // Monitoring checks
  checks: [
    { name: "worker_alive", check: "Is pane responding?" },
    { name: "worker_blocked", check: "Has worker been idle > 2 min?" },
    { name: "worker_error", check: "Has worker reported an error?" },
    { name: "memory_pressure", check: "Is memory threshold approaching?" },
    { name: "layout_valid", check: "Is BSP layout still valid?" },
    { name: "cost_tracking", check: "Are we within budget?" },
  ];
}
```

## 5. MCP Integration

### 5.1. MCP Client (Dynamic Toolsets)

The Orchestrator connects to MCP servers dynamically via `MCPClient.listToolsets()`:

```typescript
import { MCPClient } from '@mastra/mcp'

// MCP servers configured in the registry
const mcpRegistry = {
  // Local MCP servers (CLI-based)
  local: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  },
  // Remote MCP servers (URL-based)
  remote: {
    wikipedia: { url: 'https://mcp.api.wikipedia.org/mcp' },
    code-explorer: { url: 'https://code-explorer.smithery.ai/mcp' },
  },
  // Registry-discovered servers
  registries: [
    'klavis',    // Enterprise-authenticated MCPs
    'smithery',  // Community MCP marketplace
    'mcp.run',   // MCP registry
  ],
}

// For each run, load only the relevant MCP servers:
const relevantServers = mcpRegistry.filterByTask(taskDescription)
const toolsets = await mcpClient.listToolsets(relevantServers)
```

### 5.2. MCP Server (Expose Our Agents)

The system can also expose itself as an MCP server for other agents to use:

```typescript
import { MCPServer } from '@mastra/mcp'

const mastraMcpServer = new MCPServer({
  id: 'orchestrator-server',
  name: 'Mastra Orchestrator',
  version: '1.0.0',
  agents: { orchestrator },
  tools: registryTools,
  workflows: { orchestration },
})
```

### 5.3. MCP Security & Sandbox

```typescript
// MCP servers are sandboxed and permission-controlled
interface MCPServerSecurity {
  // Isolation
  sandbox: {
    enabled: true;                    // Run in isolated process
    network: boolean;                 // Can access network?
    filesystem: 'read' | 'write' | 'none';  // File access level
    environment: Record<string, string>;  // Restricted env vars
  };

  // Permissions
  permissions: {
    read: boolean;                    // Can read files?
    write: boolean;                   // Can write files?
    execute: boolean;                 // Can execute commands?
    network: boolean;                 // Can make network requests?
  };

  // Rate limiting
  rateLimit: {
    callsPerMinute: number;           // Max calls per minute
    concurrentCalls: number;          // Max concurrent calls
    timeoutMs: number;                // Call timeout
  };

  // Monitoring
  monitoring: {
    logCalls: boolean;                // Log all calls to audit trail
    trackUsage: boolean;              // Track token/cost impact
    alertOnFailure: boolean;          // Alert on server failure
  };
}

// Apply security policy per MCP server:
const securityPolicies = {
  github: {
    sandbox: { network: true, filesystem: 'read', enabled: true },
    permissions: { read: true, write: false, execute: false, network: true },
    rateLimit: { callsPerMinute: 60, concurrentCalls: 3, timeoutMs: 30_000 },
  },
  filesystem: {
    sandbox: { network: false, filesystem: 'read', enabled: true },
    permissions: { read: true, write: false, execute: false, network: false },
    rateLimit: { callsPerMinute: 120, concurrentCalls: 5, timeoutMs: 5_000 },
  },
  wikipedia: {
    sandbox: { network: true, filesystem: 'none', enabled: true },
    permissions: { read: true, write: false, execute: false, network: true },
    rateLimit: { callsPerMinute: 30, concurrentCalls: 2, timeoutMs: 10_000 },
  },
};
```

### 5.4. MCP Tool Auto-Discovery

```bash
# When a new MCP server is added, tools are auto-discovered:
$ herdr mcp discover
# Found 3 new MCP servers:
# • security-scan (local) — 5 tools — security-audit capability
# • code-review (smithery) — 8 tools — code review capability
# • api-docs (remote) — 3 tools — documentation capability

# Each tool is cataloged with metadata:
$ herdr mcp tools --detail
# Tool: security-scan.find-vulnerabilities
#   Description: Scan code for security vulnerabilities
#   Input: file_path (string) → vulnerabilities (array)
#   Category: security
#   Tags: [security, vulnerability, scan]
#   Confidence: 0.85
#
# Tool: code-review.review-file
#   Description: Review a file for code quality
#   Input: file_path (string) → review (object)
#   Category: review
#   Tags: [review, quality, code]
#   Confidence: 0.90
```

### 5.5. MCP Lifecycle Management

```typescript
// MCP server lifecycle is managed by the Orchestrator
interface MCPLifecycle {
  // 1. Discovery — find available servers
  discover(): MCPDiscovery[];

  // 2. Selection — choose relevant servers for the task
  select(taskDescription: string): MCPSelection[];

  // 3. Connection — connect to selected servers
  connect(servers: MCPSelection[]): MCPConnectionResult[];

  // 4. Tool Resolution — make tools available to agents
  resolveTools(connections: MCPConnectionResult[]): ToolDefinition[];

  // 5. Execution — route tool calls through MCP
  execute(toolCall: ToolCall): ToolResult;

  // 6. Cleanup — disconnect when done
  disconnect(): void;
}

// Tool resolution example:
// Task: "Implement user auth with security checks"
// → Selected MCPs: github, code-explorer, security-scan
// → Available tools:
//    - github.search (search repo)
//    - github.read (read file)
//    - code-explorer.search (AST search)
//    - code-explorer.read (read symbol)
//    - security-scan.find-vulnerabilities (scan for vulns)
//    - security-scan.audit-dependencies (check deps)
```



---

## 6. Library Registry Structure

```
library/
├── skills/
│   ├── code-review.skill.md      # Skill: review code from multiple angles
│   ├── testing.skill.md          # Skill: run and validate tests
│   ├── research.skill.md         # Skill: gather and synthesize information
│   └── security-audit.skill.md   # Skill: check for security vulnerabilities
│
├── tools/
│   ├── file-read.tool.ts         # Read file contents with line limits
│   ├── file-write.tool.ts        # Write/modify files with diff safety
│   ├── bash-exec.tool.ts         # Execute shell commands with timeout
│   ├── code-search.tool.ts       # AST-aware structural code search
│   └── ...                       # Registry grows as new tools are added
│
├── mcp/
│   ├── registry.json             # MCP server configuration manifest
│   ├── github.json               # GitHub MCP config
│   ├── filesystem.json           # Filesystem MCP config
│   └── ...                       # External MCP configs
│
├── layouts/
│   ├── research.json             # Research workflow layout preset
│   ├── implementation.json       # Implementation workflow layout preset
│   ├── review.json               # Review workflow layout preset
│   └── multi-agent.json          # Full multi-agent layout preset
│
├── protocols/
│   ├── signal-schema.json        # State/notification signal schemas
│   ├── approval-policy.json      # Tool approval policies
│   ├── worker-config.json        # Default worker configurations
│   └── memory-config.json        # Observational Memory per-role config
│
├── memory/
│   ├── extractors/               # Role-specific Extractor definitions
│   │   ├── orchestrator-extractor.md
│   │   ├── researcher-extractor.md
│   │   ├── planner-extractor.md
│   │   ├── reviewer-extractor.md
│   │   ├── implementer-extractor.md
│   │   ├── validator-extractor.md
│   │   └── monitor-extractor.md
│   └── recall-templates/         # Pre-built recall queries per role
│       ├── code-patterns.md
│       ├── research-findings.md
│       └── decision-log.md
│
└── auto-discovery/
    ├── scan-skills.sh            # Auto-scan for new skill files
    ├── scan-tools.sh             # Auto-scan for new tool definitions
    └── query-registries.sh       # Query MCP registries for new servers
```

---

## 7. File Structure (Project Layout)

```
mastra-agent-system/
├── src/
│   ├── mastra/
│   │   ├── index.ts              # Mastra instance (storage, agents, MCP, background tasks)
│   │   │
│   │   ├── agent-controller.ts   # AgentController setup with modes
│   │   │
│   │   ├── agents/
│   │   │   ├── orchestrator.ts   # Main orchestrator agent
│   │   │   ├── researcher.ts     # Researcher worker agent
│   │   │   ├── planner.ts        # Planner worker agent
│   │   │   ├── reviewer.ts       # Reviewer worker agent
│   │   │   ├── implementer.ts    # Implementer worker agent
│   │   │   └── validator.ts      # Validator worker agent
│   │   │
│   │   ├── tools/
│   │   │   ├── file-read.ts
│   │   │   ├── file-write.ts
│   │   │   ├── bash-exec.ts
│   │   │   └── herdr-control.ts  # Herdr CLI wrapper tool
│   │   │
│   │   ├── mcp/
│   │   │   ├── client.ts         # MCPClient configuration
│   │   │   ├── registry.ts       # MCP server registry loader
│   │   │   └── server.ts         # MCPServer (optional)
│   │   │
│   │   ├── processors/
│   │   │   ├── signal-inject.ts  # Inject state signals into agent context
│   │   │   └── tool-search.ts    # Dynamic tool discovery processor
│   │   │
│   │   └── workflows/
│   │       └── orchestration.ts  # Master orchestration workflow
│   │
│   ├── library/                  # (see §6 above)
│
│   └── herdr/
│       ├── layout-presets.json   # All BSP tree layout presets
│       ├── agent-states.ts       # Herdr ↔ Mastra state bridge
│       └── event-subscriber.ts   # Herdr event subscription manager
│
│   ├── memory/
│       ├── om-config.ts          # Shared Observational Memory config factory
│       ├── extractors.ts         # Role-specific Extractor schemas
│       └── recall-tools.ts       # Custom recall tool wrappers
│
│   ├── wiki/                     # GROOM self-maintaining wiki
│       ├── index.md
│       ├── sources.md
│       ├── glossary.md
│       ├── _meta/
│       │   ├── canaries.json
│       │   └── journal.md
│
├── test/
│   └── test-agent-system.ts      # End-to-end test script
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. Data Flow: Complete Request Lifecycle

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  User    │────▶│  Orchestrator│────▶│  AgentController │
│  Input   │     │  (Herdr pane)│     │  Thread: plan  │
│          │◀────│              │◀────│  Mode: plan    │
└──────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼  dispatches workers (background tasks)
                    ┌──────────────┐
                    │   Herdr      │
                    │   Layout     │
                    │   Manager    │
                    └──────────────┘
                    ┌────────┐ ┌────────┐ ┌────────┐
                    │Worker 1│ │Worker 2│ │Worker 3│
                    │(Herdr) │ │(Herdr) │ │(Herdr) │
                    └───┬────┘ └───┬────┘ └───┬────┘
                        │           │           │
                        ▼           ▼           ▼
                    ┌─────────────────────────────────┐
                    │  Mastra Thread (signals + memory)│
                    │  - Worker state signals          │
                    │  - Notification inbox            │
                    │  - Background task results       │
                    │  - Observational Memory (auto-   │
                    │    compression, extraction,      │
                    │    recall)                       │
                    └─────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │  Orchestrator (untilIdle stream) │
                    │  - Sees all results              │
                    │  - Dispatches next phase         │
                    │  - Re-modes via AgentController  │
                    └─────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │  Final Response to User          │
                    │  (via thread subscription)       │
                    └─────────────────────────────────┘
```

---


### 8.1. Request Lifecycle Stages

| Stage | Step | Duration | Actor | Output |
|-------|------|----------|-------|--------|
| **1. Input** | User sends task | Instant | User | Task description |
| **2. Planning** | AgentController mode: plan | 1-5s | Orchestrator | Subtask decomposition |
| **3. Research** | AgentController mode: research | 5-30s | Researcher | Findings, sources |
| **4. Task Assignment** | PlanDB task creation | <1s | Orchestrator | Task graph |
| **5. Implementation** | AgentController mode: implement | 10-120s | Implementer | Code changes |
| **6. Review** | AgentController mode: review | 5-30s | Reviewer | Review report |
| **7. Validation** | AgentController mode: validate | 5-30s | Validator | Pass/fail |
| **8. Synthesis** | Result aggregation | 1-5s | Orchestrator | Final response |
| **9. Delivery** | Response to user | <1s | Orchestrator | User output |

### 8.2. State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE                                │
│                                                                  │
│  INPUT ──▶ PLANNING ──▶ RESEARCH ──▶ IMPLEMENT ──▶ REVIEW     │
│    │          │           │            │           │            │
│    │          │           │            │           │            │
│    ▼          ▼           ▼            ▼           ▼            │
│  ERROR      SKIP        SKIP         SKIP       SKIP            │
│  (re-input) (task done) (no research │ (no review │ (auto-pass  │
│               required)   needed)     needed)     needed)        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ERROR PATH                                              │   │
│  │                                                          │   │
│  │  Any stage → ERROR → Orchestrator decides:               │   │
│  │  1. Retry (same stage, fewer steps)                      │   │
│  │  2. Skip (bypass this stage)                             │   │
│  │  3. Escalate (ask user for help)                         │   │
│  │  4. Abort (terminate session)                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  VALIDATE ──▶ SYNTHESIS ──▶ DELIVERY ──▶ COMPLETE                │
│     │              │             │               │               │
│     ▼              ▼             ▼               ▼               │
│   FAIL ──▶ IMPLEMENT (iterative)  ERROR ──▶ ERROR ──▶ ABORT      │
│                                                          (with backup) │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3. Data Flow Details

#### Input → Planning

```typescript
// 1. User input received
const userInput = {
  task: "Implement user authentication with JWT",
  context: "Express.js project, existing auth module",
  constraints: ["Use TypeScript", "Add tests", "Follow existing patterns"],
};

// 2. Orchestrator analyzes input and creates PlanDB tasks
const tasks = [
  { id: "T1", name: "Research existing auth", deps: [], kind: "research" },
  { id: "T2", name: "Create auth controller", deps: ["T1"], kind: "implement" },
  { id: "T3", name: "Set up JWT middleware", deps: ["T1"], kind: "implement" },
  { id: "T4", name: "Review auth changes", deps: ["T2", "T3"], kind: "review" },
  { id: "T5", name: "Validate auth tests", deps: ["T4"], kind: "validate" },
];

// 3. PlanDB stores tasks with dependencies
await plandb.batchAdd(tasks);
await plandb.createDependencies(tasks);
```

#### Research → Implementation

```typescript
// 1. Researcher outputs findings
const researchOutput = {
  sources: [
    { name: "project/auth.ts", type: "existing_code", quality: 0.9 },
    { name: "express-jwt-docs", type: "documentation", quality: 0.8 },
  ],
  findings: [
    "Project uses Express with TypeScript middleware pattern",
    "Existing auth module has user model but no token handling",
    "Recommended: use jsonwebtoken with refresh token pattern",
  ],
  gapAnalysis: {
    present: ["user model", "validation", "error handling"],
    missing: ["JWT generation", "token refresh", "logout"],
    questions: ["What token expiry?", "Should we use HTTP-only cookies?"],
  },
};
```

#### Implementation → Review

```typescript
// 1. Implementer outputs code changes
const implementationOutput = {
  filesChanged: [
    { path: "src/routes/auth.ts", change: "modified", lines: "+45 -3" },
    { path: "src/middleware/jwt.ts", change: "created", lines: "+67" },
    { path: "src/controllers/user.ts", change: "modified", lines: "+23 -5" },
  ],
  testsRun: ["npm test -- auth", "npm test -- user"],
  testsPassed: true,
  decisions: [
    "Used HTTP-only cookies for tokens (more secure)",
    "30min access tokens, 7day refresh tokens",
    "Follows existing middleware pattern",
  ],
  notes: "Added refresh token rotation for security",
};
```

#### Review → Validation

```typescript
// 1. Reviewer outputs review report
const reviewOutput = {
  issues: [
    { severity: "critical", category: "tests", message: "Missing logout test" },
    { severity: "high", category: "security", message: "No token rotation in logout" },
    { severity: "medium", category: "readability", message: "Complex JWT middleware" },
  ],
  overall: { pass: false, score: 0.75, summary: "Good implementation, needs logout flow" },
  suggestions: [
    "Add logout endpoint that invalidates refresh tokens",
    "Simplify JWT middleware by extracting token validation",
    "Add integration test for full auth flow",
  ],
};
```


## 9. Error Handling & Recovery

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Worker agent blocks | Herdr `pane.agent_status_changed` → `blocked` | Orchestrator reads pane output, decides to re-route or wait |
| Worker agent crashes | Herdr `pane.exited` event | Monitor spawns replacement worker, notifies orchestrator |
| Background task timeout | `background-task-failed` event | Orchestrator retries with fewer steps or different approach |
| Background task suspend | `background-task-suspended` event | Tool calls `suspend()`, resume via external approval |
| Orchestrator agent blocks | No events received for N minutes | Monitor sends signal to re-wake or escalate to user |
| Herdr server crash | Connection lost | Workers continue in background; reconnect restores state via `session.snapshot` |
| Model provider failure | Processor error | Error processor switches to fallback model |
| Memory threshold exceeded | Message tokens > `blockAfter × messageTokens` | Observer forced into synchronous mode; may briefly pause agent

---

## 10. OpenAI-Compatible Provider Configuration

```typescript
// All agents use OpenAI-compatible endpoints (vLLM default)
// Provider-agnostic via Mastra's model routing

const MODEL_CONFIG = {
  orchestrator: 'openai-compatible/vllm-gpt-5.5',     // Strong reasoning
  researcher: 'openai-compatible/vllm-gpt-5.5',        // Balanced
  planner: 'openai-compatible/vllm-gpt-5.5',           // Balanced
  reviewer: 'openai-compatible/vllm-gpt-5.5',          // Strong reasoning
  implementer: 'openai-compatible/vllm-gpt-5.5-mini',  // Fast, code-focused
  validator: 'openai-compatible/vllm-gpt-5.5-mini',    // Fast, execution
}

// Base provider config (override per deployment)
const PROVIDER_CONFIG = {
  apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
  baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL || 'http://localhost:8000/v1',
}

// Per-agent model resolution via Mastra model router
// Each agent gets its model via provider/config resolution
```

---

## 11. Guardrails

| Guardrail | Implementation | Purpose |
|-----------|---------------|---------|
| **Token limiting** | `TokenLimiter` processor on all agents | Prevent context overflow |
| **Cost guard** | `CostGuardProcessor` on orchestrator | Prevent runaway costs |
| **Prompt injection** | `PromptInjectionDetector` on worker input | Prevent injection attacks |
| **PII redaction** | `PIIDetector` on output | Prevent sensitive data leakage |
| **File write approval** | Tool approval on implementer's file tools | Human-in-the-loop for file changes |
| **Step limit** | `maxSteps` per worker agent | Prevent infinite loops |
| **Background timeout** | Configured `timeoutMs` per worker tool | Prevent hung tasks |
| **Herdr pane isolation** | Each agent in separate pane | Prevent cross-agent interference |
| **Wiki canary protection** | GROOM structural + fact validation | Prevent wiki corruption from bad edits |

---

## 12. Observability

| Observable | Source | Consumer |
|-----------|--------|----------|
| Agent states (idle/working/blocked/done) | Herdr sidebar (pane.agent_status) | User, Monitor worker, Orchestrator |
| Pane output | Herdr `pane.read()` | Orchestrator, Monitor |
| Background task status | Mastra `backgroundTaskManager.stream()` | Orchestrator, Monitor |
| Thread messages | Mastra thread subscription | User (UI), Orchestrator |
| Signal activity | Mastra signals | Orchestrator |
| Herdr events | Mastra event system via subscriptions | Orchestrator, Monitor |
| Layout changes | Herdr `layout.updated` event | Orchestrator, Monitor |
| Token usage | Mastra response.usage | Orchestrator, CostGuard |
| Memory health (obs/ref tokens) | Herdr pane report-agent | Monitor, User (sidebar) |
| Wiki status | GROOM cron/status | Monitor, User |
| Task progress | PlanDB task states | Monitor, User |

### 12.1. Observability Dashboard (Herdr Monitor Pane)

```bash
# Real-time dashboard shown in the monitor pane:

# ── Agent Status Overview ─────────────────────────────────
# [2024-01-15 14:30:00] Session: 2m 15s | Tokens: 45k | Cost: $0.03
#
# Orchestrator  [██████░░░░]  working  |  12 steps | 15,234 tok  | 2.3s avg
# Researcher    [█████████░]  done     |   8 steps |  8,456 tok  | 1.8s avg
# Planner       [██████████]  done     |   5 steps |  6,789 tok  | 1.2s avg
# Implementer   [██████░░░░]  working  |   3 steps |  4,567 tok  | 3.1s avg
# Reviewer      [░░░░░░░░░░]  idle     |   0 steps |      0 tok  | -
# Validator     [░░░░░░░░░░]  idle     |   0 steps |      0 tok  | -
#
# ── Resource Health ───────────────────────────────────────
# Memory: orchestrator  45k/120k (38%)  ✓
# Memory: implementer   32k/ 80k (40%)  ✓
# Memory: researcher    18k/ 80k (23%)  ✓
# Memory: planner       12k/ 80k (15%)  ✓
# ──────────────────────────────────────────────────────────
# Memory: monitor       15k/ 20k (75%)  ⚠️ High
# ──────────────────────────────────────────────────────────
#
# ── Task Progress ─────────────────────────────────────────
# Task: Implement user auth
#   ✅ [T1] Create auth controller       (researcher → implementer)
#   ✅ [T2] Set up JWT middleware        (implementer → done)
#   🔄 [T3] Add refresh token handler    (implementer → working)
#   ⬜ [T4] Add logout endpoint           (planner → pending)
#   ⬜ [T5] Add integration tests         (validator → pending)
#
# Progress: 2/5 tasks (40%) | ETA: ~3 min remaining
#
# ── Alerts ────────────────────────────────────────────────
# ⚠️ implementer latency high (3.1s avg > 2x baseline)
# ⚠️ monitor memory pressure (75% of threshold)
# ──────────────────────────────────────────────────────────
```

### 12.2. Event Subscription Schema

```typescript
// Herdr event subscriptions for reactive monitoring
interface HerdrEventSubscription {
  type: "pane.agent_status_changed" |
        "pane.output_matched" |
        "pane.exited" |
        "layout.updated" |
        "workspace.changed";

  pane_id?: string;           // "*" = all panes
  workspace_id?: string;
  filter?: {
    status?: string;          // Filter by agent status
    label?: string;           // Filter by pane label
    output_pattern?: string;  // Filter by output regex
  };

  callback: (event: HerdrEvent) => void;
}

// Event payload
interface HerdrEvent {
  type: string;
  timestamp: string;
  data: {
    pane_id: string;
    workspace_id: string;
    tab_id?: string;
    [key: string]: any;
  };
}
```

### 12.3. Metrics Collection Pipeline

```
┌────────────────────────────────────────────────────────────────┐
│                    METRICS PIPELINE                            │
│                                                                │
│  Sources → Collectors → Aggregators → Dashboard               │
│                                                                │
│  Source:                          Aggregator:                  │
│  • Herdr events                   • Moving averages            │
│  • Mastra thread                  • Percentiles (p50/p95/p99)  │
│  • Background tasks               • Trend detection           │
│  • Token usage                    • Alert thresholds          │
│  • Cost tracking                  • Correlation analysis      │
│                                                                │
│  Collector (5s interval):       Dashboard (real-time):        │
│  • Poll Herdr for agent states  • Agent status bars           │
│  • Read Mastra for token usage  • Token/cost gauges          │
│  • Parse background task stream • Task progress ring          │
│  • Check memory health          • Memory health bars          │
│  • Validate wiki canaries       • Canary status indicators   │
└────────────────────────────────────────────────────────────────┘
```

### 12.4. Alert Rules

| Alert | Trigger | Severity | Action |
|-------|---------|----------|--------|
| **Worker down** | Pane exits unexpectedly | Critical | Auto-restart worker |
| **High latency** | Agent latency > 2x baseline | Warning | Log warning, suggest context reduction |
| **Memory pressure** | Memory > 75% threshold | Warning | Log warning, suggest flush |
| **Cost approaching** | Cost > 80% of limit | Warning | Alert user, suggest optimization |
| **Cost limit** | Cost > 100% of limit | Critical | Block new tool calls |
| **Task timeout** | Task exceeds timeoutMs | Warning | Kill task, log error |
| **Handoff failure** | 3+ handoff nacks in 5 min | Error | Log error, suggest protocol fix |
| **Wiki corruption** | GROOM canary fails | Critical | Auto-revert wiki change |
| **PlanDB error** | SQLite integrity failure | Critical | Rebuild PlanDB, alert user |

### 12.5. Observability Commands

```bash
# Dashboard control
/obs dashboard                Show full observability dashboard
/obs agents                   Show agent status only
/obs resources                Show resource health
/obs tasks                    Show task progress
/obs alerts                   Show active alerts
/obs history <n>              Show last N events
/obs export <file>            Export observability data
/obs config <key> <value>     Configure observability settings
/obs thresholds set <rule> <value>  Set alert threshold
```



---

## 13. New Functionalities Added by This Architecture

### 14.1. Observational Memory Integration (New)

Mastra's Observational Memory gives every worker long-term memory without manual management:

- **Automatic compression** — 5–40× compression of raw messages into dense observations (emoji-prioritized log format)
- **3-tier system** — Recent messages (exact) → Observations (compressed) → Reflections (patterned)
- **Async buffering** — Observer runs in background every 20% of threshold; activation is instant, never blocks
- **Custom extractors** — Each role defines what facts matter (project structure, user preferences, blockers)
- **Semantic recall** — Vector search across all past observations; workers can look up exact past output
- **Temporal gap markers** — Workers resume correctly after hours/days of inactivity
- **Thread-scoped isolation** — Each worker's memory is isolated per thread (no cross-contamination)
- **Per-role extraction** — Role-specific Extractor schemas capture relevant facts automatically
- **Working memory auto-mgmt** — Observer manages working memory via state signals, no manual `remember()` calls
- **OpenAI-compatible** — Uses the same vLLM endpoint as all other agents, not Gemini

### 13.2. Knowledge Base Integration

Three complementary knowledge systems integrate at the architecture layer:

1. **PlanDB** — Task planning graph
   - Compound dependency graph (not flat lists)
   - Atomic multi-agent claiming (no duplicate work)
   - Critical path analysis (optimizes what to do first)
   - BM25 context surfacing (discoveries auto-surface with related tasks)
   - Pre/post conditions (gate task execution on state)
   - CLI binary — orchestrator uses `plandb` commands

2. **Neo4j Agent Memory** — Relational knowledge graph
   - 3 layers: conversations → entities/facts → reasoning traces
   - Entity extraction pipeline (spaCy/GLiNER/LLM)
   - Relationship extraction (GLiREL)
   - Entity deduplication across sessions
   - Multi-tenant scoping (per-user isolation)
   - MCP server with 16 tools
   - TypeScript SDK (or Python)

3. **GROOM** — Self-maintaining wiki
   - Stale-while-revalidate: consulting wiki triggers background refresh
   - 5 operations: lint, prune, expand, research, iterate
   - Git checkpointed: every edit is commit → validate → commit, or reset
   - Canary protection: load-bearing facts guarded by determinstic validators
   - Content-agnostic: works with any markdown knowledge base
   - Content-agnostic: zero token validation (free CI test)

### 13.3. AgentController Integration

- **Modes** replace manual phase management: `plan` → `research` → `implement` → `review` → `validate`
- **Threads** provide persistent state across restarts with mode continuity
- **Event system** gives typed events for UI and Herdr integration without polling
- **Subagents** handle worker spawning with constrained tool sets
- **Observational memory** auto-summarizes long sessions

### 13.4. Signals Architecture

- **State signals** (`sendStateSignal`) replace manual output parsing for worker → orchestrator communication
- **Notification inbox** (`sendNotificationSignal`) for external events (CI, GitHub, Slack)
- **Reactive signals** from processors for context injection
- **Conditional attributes** (`ifActive`/`ifIdle`) for smart delivery routing

### 13.5. Background Task Lifecycle

- Workers are background tasks — orchestrator stream never blocks
- `untilIdle` auto-re-invokes orchestrator when workers complete
- **Suspend/resume** pattern for human approval flows
- **Lifecycle callbacks** for logging and notification
- **Per-tool timeout** and retry configuration
- **Manager-level streaming** for all task events

### 13.6. Herdr Layout Presets

- **Declarative layouts** saved as JSON trees, applied via `layout.apply()`
- **Presets per workflow** — each phase (research, implement, review) gets its own layout
- **Auto-restore** on session recovery
- **Dynamic resize** via `layout.set_split_ratio`
- **Export/save** current layout for learning/improvement

---

## 15. Human-Agent Interaction Protocol (Terminal-Native UI/UX)

### 15.1. Command Syntax

All user interactions use a structured `/command` syntax that is:

- Parseable by both humans and machines
- Consistent across all agent responses
- Terminal-width-adaptive (wraps to fit the terminal width)

```bash
# Run a new task
/run <task_description>

# View current tasks
/tasks list
/tasks status <task_id>
/tasks cancel <task_id>

# Session management
/session start <name>
/session resume <id>
/session snapshot
/session restore <snapshot_id>

# Approval flows (for human-in-the-loop)
/approve <action_id> yes|no|modify
/approve list
/approve deny <action_id>

# Worker management
/worker list
/worker focus <worker_id>
/worker send <worker_id> <message>
/worker stop <worker_id>

# Monitoring
/monitor status
/monitor logs <worker_id>
/monitor metrics

# Plugin management
/plugin install <id|url>
/plugin list
/plugin disable <id>
/plugin enable <id>

# Error recovery
/heal trigger
/heal status
/heal history

# Plugin & Extension System
/plugin install <id|url>      Install from registry/URL
/plugin install local <path>  Install from local path
/plugin update [id]           Update one or all plugins
/plugin uninstall <id>        Remove plugin
/plugin enable <id>           Enable plugin
/plugin disable <id>          Disable plugin
/plugin list                  List all plugins
/plugin info <id>             Show plugin details
/plugin search <query>        Search registry
/plugin verify <id>           Verify plugin integrity
/plugin categories            List available categories
/plugin export <id>           Export plugin as package
/plugin import <file>         Import plugin from file
/plugin health                Show plugin health status
/plugin logs <id>             Show plugin logs
```

### 15.2. Structured Agent Responses

All agent responses follow a consistent format:

```markdown
[AGENT:orchestrator] [STATUS:working] [PHASE:implement]

> Task: Implement user authentication
> Progress: 2/5 tasks complete

📋 Current work:
  ✅ Task 1: Create auth controller
  ✅ Task 2: Set up JWT middleware  
  🔄 Task 3: Add refresh token handler
  ⬜ Task 4: Add logout endpoint
  ⬜ Task 5: Add integration tests

⚠️ Blocks: None
🔧 Tools active: file-write, bash, code-search

---
[END AGENT:orchestrator]
```

### 15.3. Human-in-the-Loop Approval Gating

```bash
# Orchestrator detects a file-write needs approval
# → Sends notification signal to user
# → User sees: "Worker implementer wants to modify auth.ts. Approve?"
# → User responds: /approve <action_id> yes|no|modify <instructions>

# If modify:
# The orchestrator re-injects user's instructions to the implementer
# Implementation continues with user's modifications
```

### 15.4. Live Streaming Updates

- **Herdr sidebar** shows real-time agent states (idle/working/blocked/done)
- **Worker panes** stream LLM output directly (token-by-token visible)
- **Monitor pane** shows consolidated status, errors, memory health
- **Orchestrator pane** shows current phase, task list, dispatch decisions
- **Terminal keyboard shortcuts** allow interrupting, focusing, or zooming any worker

### 15.5. Terminal-Width Adaptive Rendering

```bash
# Agent output automatically adapts to terminal width
# Narrow terminal (80 cols):      [worker] status: working, task: file-write, progress: 40%
# Wide terminal (160+ cols):      [worker] 🟢 implementer (w1:p3) | status: working | task: file-write | progress: 40% | elapsed: 2m 15s

# Orchestrator uses width-detection to format output
const terminalWidth = process.stdout.columns || 80;
const format = terminalWidth > 120 ? 'full' : 'compact';
```

---

## 16. Session Persistence & Recovery

### 16.1. Multi-Level State Storage

```typescript
// 8 levels of persistence from ephemeral to durable:

interface SessionSnapshot {
  // Level 1: Current task (ephemeral, volatile)
  currentTask: string;
  currentPhase: string;  // plan | research | implement | review | validate
  currentWorkers: WorkerState[];

  // Level 2: Mastra thread state (auto-saved per turn)
  mastraThread: {
    id: string;
    messages: AIMessage[];  // Last 50 messages (auto-compressed)
    mode: string;
    agentStates: Record<string, WorkerState>;
  };

  // Level 3: Background task state (auto-saved on completion)
  backgroundTasks: BackgroundTaskState[];

  // Level 4: PlanDB task graph (saved on every task state change)
  planDB: {
    tasks: TaskNode[];
    claimStates: Map<string, string>;  // taskId → workerId
  };

  // Level 5: Neo4j knowledge graph (buffered writes, 30s flush)
  knowledgeGraph: {
    entities: Entity[];
    relationships: Relationship[];
    reasoningTraces: ReasoningTrace[];
  };

  // Level 6: Wiki state (git checkpointed per write)
  wiki: {
    pages: WikiPage[];
    lastCommit: string;
    dirty: boolean;
  };

  // Level 7: Herdr workspace state (snapshot on save)
  herdrWorkspace: {
    workspaceId: string;
    layout: BSPNode;
    paneStates: Record<string, PaneState>;
  };

  // Level 8: Plugin state (persistent on disk)
  plugins: PluginState[];
}
```

### 16.2. Auto-Save Triggers

| Trigger | What Gets Saved | Frequency |
|---------|----------------|-----------|
| **Every turn** | Thread messages, agent states | Instant (auto) |
| **Task complete** | PlanDB task state, task result | Instant |
| **Task state change** | PlanDB claim, done, context | Instant |
| **Memory threshold** | Observations, reflections | Every 30k tokens |
| **Every 5 minutes** | Herdr layout, plugin state | Poll |
| **Wiki write** | Page content, git commit | On-write |
| **Session end** | Full snapshot (all levels) | On-demand |
| **Crash** | Last known state (OS signals) | On-signal |

### 16.3. Recovery Scenarios

```bash
# Scenario 1: Process crash
# → Herdr detects pane exit
# → Monitor spawns fresh workers
# → Workers reconnect to Mastra thread
# → Thread state restored from storage
# → Workers resume from last checkpoint

# Scenario 2: Network disconnect (user leaves terminal)
# → Workers continue running (background tasks)
# → On reconnect, user sees all worker panes with last state
# → /session snapshot saves current state
# → /session restore loads latest snapshot

# Scenario 3: Server restart (all panes killed)
# → On restart, orchestrator reads:
#   - Herdr workspace snapshot (workspace ID)
#   - PlanDB task graph
#   - Mastra thread state
# → Re-spawns all workers from task graph
# → Workers resume from their last checkpoint

# Scenario 4: Manual suspend
# → /session save <name>
# → All workers paused
# → Full state persisted
# → /session resume <name> restores everything
```

### 16.4. Session Commands

```bash
# Save current session state
/session save <name>               # Named snapshot
/session save --auto               # Auto-save on completion

# Restore a session
/session restore <name|id>         # Restore by name or ID
/session restore latest            # Restore most recent snapshot

# List saved sessions
/session list                      # Show all saved snapshots
/session info <id>                 # Show snapshot details

# Session lifecycle
/session start <name>              # Start new session
/session end                       # End current session (auto-save)
/session compact                   # Compress thread, free tokens
/session export <name>             # Export full session as JSON
/session import <file>             # Import session from JSON
```

---

## 17. Error Recovery & Self-Healing

### 17.1. Failure Categories & Response Matrix

| Failure | Detection | Auto-Recovery | Human Intervention |
|---------|-----------|---------------|-------------------|
| **Worker hallucination** | Validator fails + pattern match | Retry with stricter prompt | Escalate if 3+ retries fail |
| **Infinite loop** | Step counter + token budget | Kill worker, reduce steps | Manual review if 5+ loops |
| **Bad code change** | Test failure + diff analysis | Revert + try alternative approach | Show diff if user asks |
| **Resource exhaustion** | Token limit + memory monitor | Flush memory, reduce context | Alert if persistent |
| **MCP server down** | Connection error + timeout | Fallback to built-in tools | Retry after timeout period |
| **PlanDB corruption** | SQLite integrity check | Rebuild from PlanDB context | Manual restore from backup |
| **Knowledge graph inconsistency** | Circular dependency detection | Break cycle, log warning | Human decides which to keep |
| **Wiki corruption** | GROOM canary validation | Auto-revert last wiki change | Alert if 3+ corruptions |
| **Layout drift** | BSP tree validation | Auto-restore layout preset | Log warning only |

### 17.2. Auto-Recovery Protocols

**Protocol 1: Worker Retry (Transient Errors)**

```
1. Worker fails → validator detects issue
2. Orchestrator analyzes failure pattern:
   a. Hallucination → Re-try with stricter system prompt
   b. Infinite loop → Re-try with reduced step budget
   c. Resource error → Re-try with flushed memory
3. If retry succeeds → continue normally
4. If retry fails → escalate to next protocol
```

**Protocol 2: Context Reduction (Resource Errors)**

```
1. Memory monitor detects threshold breach
2. Orchestrator requests memory flush:
   a. Compress observations (emoji dedup)
   b. Drop low-priority recent messages
   c. Activate temporal gap markers
3. If still over threshold → skip least-important worker
4. Log warning to monitor pane
```

**Protocol 3: Fallback Degradation (Component Failures)**

```
1. Component failure detected (MCP, PlanDB, etc.)
2. Orchestrator activates fallback:
   a. MCP down → Use built-in tools only
   b. PlanDB corrupt → Fall back to flat task list
   c. Neo4j unavailable → Use memory recall only
3. Log degraded mode to monitor pane
4. Attempt component recovery in background
```

### 17.3. Self-Healing Workflow

```
  MONITOR (Always on)
       │
       ▼ Detect anomaly
  DIAGNOSIS
    1. Categorize: Transient / Persistent
    2. Check: Has this happened before?
    3. Pattern: What component is affected?
       │
       ▼
  RECOVERY STRATEGY
    Transient → Retry (Protocol 1)
    Resource  → Reduce Context (Protocol 2)
    Component → Fallback (Protocol 3)
    Unknown   → Alert User (Manual)
       │
       ▼
  VALIDATION
    Recovery succeeded? → Resume workflow
    Recovery failed? → Escalate to next level
       │
       ▼
  LEARNING
    Log recovery to wiki:
    - What failed
    - How it was fixed
    - Whether the fix was correct
    Update canaries with new pattern
```

### 17.4. Escalation Chain

| Level | Action | Description |
|-------|--------|-------------|
| **0: Auto-Recovery** | 0-3 retries | Worker self-recovery, context reduction, fallback activation |
| **1: Orchestrator** | Rework | Re-decompose task, re-assign workers, change approach |
| **2: Human Alert** | `/approve` | Show failure summary, propose resolution, wait for human |
| **3: Full Reset** | Archive → Restore | Archive current session, restore from snapshot, re-ask |
| **4: Emergency** | All panes killed | State backed up to /workspace/export/, mark RECOVERY_NEEDED |

### 17.5. Error Logging & Diagnostics

```bash
# Auto-generated error diagnostics (visible in monitor pane):

# ── Session Log ────────────────────────────────────────────
# [2024-01-15 14:32:01] ERROR: implementer (w1:p3) failed
#   - Tool: file-write
#   - Error: EACCES: permission denied
#   - Retry count: 1/3
#   - Fallback: Using read-only mode
#   - Wiki updated: wiki/errors/permission-denied.md

# ── Recovery Summary ──────────────────────────────────────
# [2024-01-15 14:32:05] RECOVERY: implementer restored
#   - Strategy: Context reduction
#   - Result: Success (reduced context by 40%)
#   - Wiki updated: wiki/patterns/recovery-success.md

# ── Canary Alerts ─────────────────────────────────────────
# [2024-01-15 14:32:10] CANARY: knowledge-graph integrity
#   - Status: DEGRADED
#   - Issue: Circular reference detected
#   - Auto-fix: Removed cycle, logged to wiki
```

### 17.6. Self-Healing Commands

```
/heal trigger               Force self-healing trigger
/heal status                Show current recovery status
/heal history               Show past recovery events
/heal reset                 Reset recovery counters
/heal disable               Pause auto-recovery
/heal enable                Resume auto-recovery
/heal level <N>             Set max auto-recovery level
/heal export                Export error log
/heal import <log>          Import error patterns
/heal test                  Test recovery with synthetic
/canary list                List active canaries
/canary status <name>       Check specific canary status
/canary update              Re-run canary validation
```

---

## 18. Performance & Metrics Monitoring

The system needs real-time visibility into performance bottlenecks, costs, and agent health. This section defines the metrics layer.

### 18.1. Core Metrics Categories

| Category | Metrics | Purpose |
|----------|---------|--------|
| **Performance** | Latency, throughput, queue depth, timeout rate | Detect bottlenecks |
| **Cost** | Token usage, API calls, cost per phase | Budget management |
| **Quality** | Retry rate, failure rate, approval rate, handoff success | Detect patterns |
| **Resource** | Memory usage, context size, worker concurrency | Capacity planning |
| **Agent** | Steps taken, tokens per step, idle time | Agent efficiency |

### 18.2. Metrics Collection

```typescript
interface MetricsCollector {
  recordTokenUsage(agent: string, phase: string, tokens: number): void;
  recordDuration(agent: string, phase: string, durationMs: number): void;
  recordOutcome(agent: string, operation: string, success: boolean): void;
  recordToolUsage(agent: string, tool: string, latencyMs: number): void;
  recordHandoff(from: string, to: string, success: boolean): void;
  recordMemoryHealth(agent: string, metrics: {
    messageTokens: number;
    observationTokens: number;
    reflectionTokens: number;
    gapCount: number;
  }): void;
  getMetrics(): AgentMetrics[];
  getSummary(): PerformanceSummary;
}
```

### 18.3. Performance Dashboard (Herdr)

```bash
# ── Performance Dashboard ─────────────────────────────────
# [2024-01-15 14:30:00] Session: 2m 15s | Tokens: 45k/300k | Cost: $0.03
#
# ┌──────────────┬────────┬────────┬────────┬────────┐
# │ Agent        │ Status │ Steps  │ Tokens │ Latency│
# ├──────────────┼────────┼────────┼────────┼────────┤
# │ orchestrator │ working│ 12     │ 15,234 │ 2.3s   │
# │ researcher   │ done   │ 8      │ 8,456  │ 1.8s   │
# │ planner      │ done   │ 5      │ 6,789  │ 1.2s   │
# │ implementer  │ working│ 3      │ 4,567  │ 3.1s   │
# │ reviewer     │ idle   │ 0      │ 0      │ -      │
# │ validator    │ idle   │ 0      │ 0      │ -      │
# └──────────────┴────────┴────────┴────────┴────────┘
#
# ── Bottleneck Detection ──────────────────────────────────
# ⚠️ implementer: High latency (3.1s avg, 1.8s threshold)
#    → Possible: Large context, complex tool calls
#
# ── Cost Tracking ─────────────────────────────────────────
# Model         | Tokens   | Cost     | % of Total
# gpt-5.5       | 32,456   | $0.022   | 73%
# gpt-5.5-mini  | 12,544   | $0.008   | 27%
# ─ Total: $0.030 ──────────────────────────────────────────
```

### 18.4. Bottleneck Detection Rules

| Rule | Condition | Action |
|------|-----------|--------|
| **High latency** | Agent latency > 2x baseline | Log warning, suggest context reduction |
| **Token spike** | Agent uses > 3x avg tokens/step | Log alert, suggest tool optimization |
| **Retry storm** | Same agent retries > 3x in 5 min | Log error, suggest prompt improvement |
| **Idle agent** | Agent idle > 2 min after task assigned | Check if blocked, suggest intervention |
| **Queue build-up** | > 5 tasks waiting in PlanDB | Log warning, suggest parallel execution |
| **Memory pressure** | > 80% of observation threshold | Log warning, suggest context reduction |
| **Cost anomaly** | Cost > 3x expected for phase | Log alert, suggest approach change |
| **Handoff failure** | Handoff nack > 2x in 5 min | Log error, suggest protocol fix |

### 18.5. Optimization Commands

```bash
/perf report                  Show full performance report
/perf bottleneck              Show detected bottlenecks
/perf tokens <agent>          Show token usage for agent
/perf cost <agent>            Show cost for agent
/perf latency <agent>         Show latency stats
/perf optimize <agent>        Suggest optimizations
/perf set <metric> <value>    Adjust performance threshold
/perf reset <metric>          Reset to defaults
/perf export <file>           Export metrics as JSON
/perf compare <id>            Compare with previous session
```

## 19. Security & Audit Trail

### 19.1. Threat Model

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| **Prompt injection** | User input → agent system prompt | PromptInjectionDetector processor |
| **PII leakage** | Output → terminal/pane | PIIDetector processor on outputs |
| **Unauthorized file access** | Worker tool → filesystem | Sandboxed file access, read-only by default |
| **Unauthorized command execution** | Worker tool → bash | Command allowlist, sandbox, timeout |
| **Plugin tampering** | Plugin install → system | Hash verification, sandbox, permissions |
| **Knowledge graph poisoning** | Wiki/graph → all workers | GROOM canary validation, audit trail |
| **Cross-agent data leakage** | Agent A → Agent B | Thread-scoped memory, no cross-thread |
| **Cost abuse** | Infinite loop → tokens/minutes | Token limiter, cost guard, step limits |
| **Session hijacking** | Terminal access | Herdr workspace isolation, auth |

### 19.2. Audit Trail System

```typescript
interface AuditEntry {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  agent: string;                 // Who performed the action
  action: string;                // What was done
  target: string;                // What was affected
  result: 'success' | 'failure' | 'blocked';
  details: object;               // Additional context
  cost?: { tokens: number; cost: number; };
}

// Audit categories (always logged):
const AUDIT_CATEGORIES = {
  tool_call: 'Tool execution by worker',
  file_write: 'File modification by implementer',
  command_run: 'Shell command execution',
  handoff: 'Agent-to-agent context transfer',
  approval: 'Human approval/denial',
  plugin_install: 'Plugin installation/upgrade',
  plugin_disable: 'Plugin deactivation',
  error_recovery: 'Self-healing trigger',
  memory_flush: 'Context compression',
  layout_change: 'Workspace layout modification',
};
```

### 19.3. Audit Log Format

```bash
# ── Audit Log (real-time feed to monitor pane) ────────────
# [2024-01-15 14:32:01] [IMPLEMENTER] tool:file-write → result:success
# [2024-01-15 14:32:02] [REVIEWER] handoff → implementer | result:success
# [2024-01-15 14:32:05] [USER] approval:approve | action:auth.ts | result:yes
# [2024-01-15 14:32:10] [MONITOR] recovery:error-retry | worker:implementer | result:success
# [2024-01-15 14:32:15] [PLUGIN] install | id:security-audit | source:registry | result:success
# [2024-01-15 14:32:20] [ORCHESTRATOR] layout_change | preset:multi-agent | result:applied
```

### 19.4. Security Commands

```bash
/security report              Show security posture report
/security audit               Show audit trail
/security check               Run security scan on current state
/security enable-audit        Enable audit logging
/security disable-audit       Disable audit logging (not recommended)
/security export-audit <file> Export audit trail as JSON
/security whitelist <command> Add command to allowlist
/security blacklist <command> Remove command from allowlist
```

### 19.5. Token & Cost Guardrails

```typescript
const GUARDRAILS = {
  // Per-agent token limits
  agent: {
    orchestrator: { messageTokens: 120_000, observationTokens: 40_000, blockAfter: 144_000 },
    researcher: { messageTokens: 80_000, observationTokens: 30_000, blockAfter: 96_000 },
    implementer: { messageTokens: 80_000, observationTokens: 30_000, blockAfter: 96_000 },
    reviewer: { messageTokens: 80_000, observationTokens: 30_000, blockAfter: 96_000 },
    validator: { messageTokens: 40_000, observationTokens: 15_000, blockAfter: 48_000 },
    monitor: { messageTokens: 20_000, observationTokens: 10_000, blockAfter: 24_000 },
  },

  // Cost limits
  cost: {
    perAgent: 0.50,              // Max $0.50 per agent
    perSession: 10.00,           // Max $10.00 per session
    perPhase: 2.00,              // Max $2.00 per phase
    alertThreshold: 0.75,        // Alert at 75% of limit
    blockThreshold: 1.0,         // Block at 100% of limit
  },

  // Step limits
  steps: {
    orchestrator: 100,
    researcher: 50,
    planner: 30,
    implementer: 50,
    reviewer: 30,
    validator: 20,
    monitor: 10,
  },

  // Timeout limits
  timeouts: {
    default: 300_000,            // 5 minutes
    implementer: 600_000,        // 10 minutes (complex code)
    researcher: 300_000,         // 5 minutes
    reviewer: 180_000,           // 3 minutes
    validator: 120_000,          // 2 minutes
  },
};
```



## 20. Testing & Validation Strategy

The system needs rigorous self-testing at multiple levels to ensure reliability. This section defines the testing pyramid.

### 20.1. Testing Pyramid

```
┌────────────────────────────────────────────────────────────────┐
│                    TESTING PYRAMID                              │
│                                                                │
│                          ▲                                     │
│                         /|\                                    │
│                        / |\                                    │
│                       /  |\  Integration Tests (3 agents)     │
│                      /   |\                                    │
│                     /    |\                                    │
│                    /     |\  System Tests (full workflow)      │
│                   /      |\                                    │
│                  /       |\                                    │
│                 /        |\  E2E Tests (user → output)        │
│                /         |\                                    │
│               /__________|\                                    │
│              / Unit Tests │                                    │
│             /_____________\                                   │
│                                                                │
│  Unit: 70%  Integration: 20%  System: 7%  E2E: 3%             │
└────────────────────────────────────────────────────────────────┘
```

### 20.2. Unit Tests (Per-Agent)

Each agent role gets unit tests covering its specific responsibilities:

```bash
# Orchestrator tests
/test test agents/orchestrator --unit

# Researcher tests
/test test agents/researcher --unit

# Planner tests
/test test agents/planner --unit

# Reviewer tests
/test test agents/reviewer --unit

# Implementer tests
/test test agents/implementer --unit

# Validator tests
/test test agents/validator --unit

# Monitor tests
/test test agents/monitor --unit
```

| Test Category | What's Tested | Coverage Target |
|---------------|---------------|----------------|
| **Agent prompts** | System prompts, instructions, tools | All prompt paths |
| **Tool calls** | Input/output schema validation | 100% of tools |
| **Error handling** | Error recovery, fallbacks | 90% of error paths |
| **Memory** | Observation, extraction, recall | All extractors |
| **Signals** | State signals, notifications | All signal types |
| **Handoffs** | Message format, ack/nack | All handoff types |

### 20.3. Integration Tests

```bash
# Test agent-to-agent communication
/test test integration handoffs

# Test PlanDB integration
/test test integration pldb

# Test Neo4j integration
/test test integration neo4j

# Test GROOM wiki integration
/test test integration groom

# Test MCP client integration
/test test integration mcp

# Test Herdr integration
/test test integration herdr

# Test Observational Memory
/test test integration memory
```

| Test Case | Agents Involved | Description |
|-----------|-----------------|-------------|
| **Research → Plan** | Researcher → Planner | Handoff with sources |
| **Plan → Implement** | Planner → Implementer | Handoff with tasks |
| **Implement → Review** | Implementer → Reviewer | Handoff with diff |
| **Review → Implement** | Reviewer → Implementer | NACK with issues |
| **Implement → Validate** | Implementer → Validator | Handoff with test plan |
| **Multi-agent loop** | Full pipeline | End-to-end workflow |

### 20.4. System Tests

```bash
# Run a complete workflow simulation
/test test system --workflow research
/test test system --workflow implement
/test test system --workflow review

# Test error recovery
/test test system --recovery worker-hallucination
/test test system --recovery context-exhaustion
/test test system --recovery mcp-down
/test test system --recovery plandb-corrupt

# Test session persistence
/test test system --persistence crash-recovery
/test test system --persistence server-restart
/test test system --persistence manual-suspend

# Test plugin lifecycle
/test test system --plugin install-remove
/test test system --plugin enable-disable
/test test system --plugin update
```

### 20.5. Quality Gates

| Gate | Check | Pass Criteria |
|------|-------|---------------|
| **Prompt quality** | No open-ended instructions | 100% specific instructions |
| **Tool safety** | No unsafe file commands | 0 risky tools |
| **Memory health** | No context rot warnings | 0 gaps, <50% threshold |
| **Agent efficiency** | Steps per outcome reasonable | < 50 steps per task |
| **Cost efficiency** | Tokens per outcome tracked | Within 2x expected |
| **Handoff success** | ACK rate measured | > 95% ACK rate |
| **Recovery rate** | Auto-recovery succeeds | > 90% auto-recovery |

### 20.6. Testing Commands

```bash
# Test management
/test test agents/orchestrator --unit          # Unit test orchestrator
/test test integration handoffs                # Test handoffs
/test test system --workflow implement         # Test full workflow
/test test system --recovery worker-hallucination  # Test recovery
/test test system --persistence crash          # Test persistence
/test test benchmarks                          # Run performance benchmarks
/test test lint                                # Test prompt/tool linting
/test test --coverage                          # Show coverage report
/test test --watch                             # Watch mode (re-run on change)
/test test --report <file>                     # Generate test report
```

---



## 21. Configuration System

The system uses a layered configuration approach with profiles, defaults, and runtime overrides.

### 20.1. Configuration Hierarchy

```
┌────────────────────────────────────────────────────────────────┐
│                  CONFIGURATION HIERARCHY                        │
│                                                                │
│  Level 1: Built-in Defaults (hardcoded)                       │
│    ├── agent.model = "gpt-5.5"                                │
│    ├── agent.maxSteps = 100                                   │
│    ├── agent.timeoutMs = 300_000                              │
│    └── ...                                                    │
│           │                                                    │
│  Level 2: Config File (.mastra/config.yaml)                   │
│    ├── overrides defaults                                     │
│    ├── defines profiles (dev, test, prod)                     │
│    └── secrets references                                     │
│           │                                                    │
│  Level 3: Environment Variables (.env, .env.local)             │
│    ├── overrides config file                                  │
│    ├── secrets (API keys, URLs)                               │
│    └── profile selection (MAISTRA_PROFILE=dev)                │
│           │                                                    │
│  Level 4: Runtime Overrides (CLI args, /config commands)       │
│    ├── /config set agent.model gpt-5.5-mini                  │
│    ├── /config reset agent.model                              │
│    └── /config show                                           │
│           │                                                    │
│  Level 5: Per-Run Overrides (orchestrator decisions)          │
│    ├── Worker-specific toolsets                                │
│    ├── Per-agent model selection                              │
│    └── Dynamic task-specific config                           │
└────────────────────────────────────────────────────────────────┘
```

### 20.2. Configuration File Format

```yaml
# .mastra/config.yaml
# ── Global Settings ──────────────────────────────────────────────
system:
  name: "mastra-agent-system"
  version: "0.1.0"
  profile: dev  # dev | test | prod

# ── Provider Configuration ──────────────────────────────────────
provider:
  default: openai-compatible
  endpoints:
    openai-compatible:
      baseUrl: ${OPENAI_COMPATIBLE_BASE_URL:http://localhost:8000/v1}
      apiKey: ${OPENAI_COMPATIBLE_API_KEY:}
      models:
        strong: gpt-5.5
        balanced: gpt-5.5-mini
        fast: gpt-5.5-turbo

# ── Agent Settings ──────────────────────────────────────────────
agents:
  orchestrator:
    model: ${AGENT_MODEL:gpt-5.5}  # Falls back to config default
    maxSteps: 100
    timeoutMs: 300_000
    tools: [orchestrator, herdr, signals, plandb, mcp]

  researcher:
    model: ${AGENT_MODEL_RESEARCHER:gpt-5.5-mini}
    maxSteps: 50
    timeoutMs: 300_000
    tools: [web-search, file-read, code-search, mcp]

  implementer:
    model: ${AGENT_MODEL_IMPLEMENTER:gpt-5.5-mini}
    maxSteps: 50
    timeoutMs: 600_000
    tools: [file-write, bash, code-search, mcp]

# ── Background Tasks ────────────────────────────────────────────
background:
  enabled: true
  globalConcurrency: 10
  perAgentConcurrency: 5
  backpressure: queue
  defaultTimeoutMs: 300_000

# ── Memory Configuration ────────────────────────────────────────
memory:
  storage: libsql
  storageUrl: file:./memory.db
  observation:
    messageTokens: 30_000
    bufferTokens: 0.2
    blockAfter: 1.2
  reflection:
    observationTokens: 40_000

# ── Plugin Configuration ────────────────────────────────────────
plugins:
  registry: klavis
  autoInstall: false
  sandboxDefault: true
  allowedPermissions:
    - file-read
    - bash
    - web-search
    - file-write

# ── Herdr Configuration ────────────────────────────────────────
herdr:
  workspace: default
  layoutPreset: multi-agent
  autoRestore: true
  reportInterval: 5000  # ms

# ── Profiles ─────────────────────────────────────────────────────
profiles:
  dev:
    logLevel: debug
    costGuard: false
    testMode: true
    plugins:
      autoInstall: true

  test:
    logLevel: info
    costGuard: true
    costLimit: 1.00
    testMode: true

  prod:
    logLevel: warn
    costGuard: true
    costLimit: 10.00
    testMode: false
    plugins:
      autoInstall: false
      sandboxDefault: true
```

### 20.3. Configuration Commands

```bash
# Configuration management
/config show [key]                  Show config (full or specific key)
/config set <key> <value>           Set config value
/config unset <key>                 Unset config value (use default)
/config reset                       Reset to defaults
/config export <file>               Export config to file
/config import <file>               Import config from file

# Profile management
/config profile list                List available profiles
/config profile set <name>          Switch profile
/config profile export <name>       Export profile
/config profile import <name> <file> Import profile
/config profile diff                Show profile differences

# Environment management
/env list                           List all environment variables
/env set <key> <value>             Set environment variable
/env unset <key>                    Unset environment variable
```

### 20.4. Secrets Management

```bash
# Secrets are stored separately from config (never in .yaml files)
/secrets list                       List secret names (not values)
/secrets set <name> <value>         Set secret value (encrypted)
/secrets unset <name>               Remove secret
/secrets rotate <name>              Rotate secret value
/secrets export <file>              Export secrets (encrypted)

# References in config use ${SECRET_NAME:default} syntax
# The system resolves secrets at runtime, never in plain text
```

### 20.5. Configuration Validation

```typescript
// Config is validated before application
interface ConfigValidator {
  // Check required fields
  validateRequired(config: Config): ValidationError[];
  
  // Check value ranges
  validateRanges(config: Config): ValidationError[];
  
  // Check cross-field consistency
  validateConsistency(config: Config): ValidationError[];
  
  // Check security settings
  validateSecurity(config: Config): ValidationError[];
  
  // Generate validation report
  generateReport(config: Config): ValidationReport;
}

// Common validation rules:
const RULES = {
  agent.maxSteps: { min: 1, max: 500, default: 100 },
  agent.timeoutMs: { min: 10_000, max: 600_000, default: 300_000 },
  cost.perSession: { min: 0.10, max: 100.00, default: 10.00 },
  memory.observation.messageTokens: { min: 10_000, max: 200_000, default: 30_000 },
  background.concurrency: { min: 1, max: 50, default: 10 },
};
```

---

## 22. What This Architecture Gives Us

1. **Full agent visibility** — Every worker in a Herdr pane, state visible in sidebar
2. **Stack-agnostic** — No hardcoded framework dependencies; tools/MCPs dynamic
3. **Per-run customization** — Each run curates its own worker toolsets
4. **Non-blocking execution** — Background tasks keep the orchestrator stream flowing
5. **Persistent state** — AgentController threads + Herdr sessions survive restarts
6. **Declarative layouts** — BSP tree presets for instant re-arrangement
7. **Signal-based communication** — Clean, typed agent-to-agent messaging
8. **External tool access** — MCP Client connects to any MCP server dynamically
9. **Guardrails throughout** — Token limits, cost guards, approvals, injection detection
10. **Observability end-to-end** — Herdr sidebar + Mastra events + background task streams
11. **Terminal-native UI** — Structured commands, parseable responses, live updates, adaptive rendering
12. **Human-in-the-loop** — Approval flows, `/approve` gating, interruptible operations
13. **Session persistence** — Multi-level save points, auto-recovery, snapshot/restore, crash resilience
14. **Self-healing** — Auto-detection, escalation chain, fallback degradation, learning from failures
15. **Reliable handoffs** — Structured context transfer, chain of custody, ack/nack protocol
16. **Plugin extensibility** — Custom tools, skills, workers, processors with security model
17. **Performance monitoring** — Real-time dashboards, bottleneck detection, cost tracking
18. **Security & audit** — Threat model, audit trail, token/cost guardrails, allowlists
19. **Terminal-native UX** — `/run`, `/tasks`, `/approve`, `/session`, `/heal`, `/plugin` commands
20. **Self-healing** — Auto-detection, 3 recovery protocols, 4-level escalation chain
21. **Multi-agent handoffs** — Structured context transfer, ack/nack, chain of custody
22. **Session persistence** — 8-level state storage, auto-save triggers, 4 recovery scenarios

---

## 23. Multi-Agent Handoff Protocol

Workers don't just work in isolation — they need to pass context, findings, and state to each other reliably. This section defines the handoff protocol.

### 19.1. Handoff Types

| Type | From | To | Trigger | Data |
|------|------|----|---------|------|
| **Research → Plan** | Researcher | Planner | Research complete | Sources, findings, gap analysis |
| **Plan → Implement** | Planner | Implementer | Plan approved | Tasks, dependencies, strategy notes |
| **Implement → Review** | Implementer | Reviewer | Code changes done | Diff, test results, notes |
| **Review → Implement** | Reviewer | Implementer | Issues found | Issue list, severity, suggested fixes |
| **Implement → Validate** | Implementer | Validator | Implementation done | Test plan, edge cases covered |
| **Research → Wiki** | Any worker | Wiki | Learning captured | Pattern, decision, error, reference |

### 19.2. Handoff Message Schema

```typescript
interface AgentHandoff {
  id: string;                    // UUID for tracking
  from: string;                  // Sending worker role
  to: string;                    // Target worker role
  timestamp: string;             // ISO 8601
  phase: string;                 // Current workflow phase
  taskId?: string;               // Related task ID

  findings: {
    summary: string;             // High-level summary
    details: string;             // Detailed findings
    sources?: string[];          // Source references
    confidence: number;          // 0.0 - 1.0
  };

  state: {
    current: string;             // Current working context
    blocker?: string;            // Current blocker (if any)
    nextAction?: string;         // Recommended next action
    context: object;             // Serialized working context
  };

  handoffType: 'sync' | 'async'; // Sync: wait for ack. Async: fire-and-forget.
  ackRequired: boolean;
  ttl?: string;                  // Time to live for this handoff
}
```

### 19.3. Handoff Flow

```
Sender:
  1. Compose handoff message (findings + state + context)
  2. Send to target via Mastra thread signal
  3. Log handoff to wiki: wiki/handoffs/
  4. Set ack timeout (if ackRequired)

Receiver:
  1. Parse handoff message
  2. Update local context with sender's context
  3. Update memory with new findings
  4. Check for blockers in handoff context
  5. Start processing

  Success? ──Yes──▶ ACK sent ──→ Sender notified
       │
       ▼No
  NACK sent ──▶ Escalate to orchestrator
```

### 19.4. Context Preservation Rules

| Rule | Description |
|------|-------------|
| **Don't lose critical context** | File paths, function signatures, API endpoints, error messages, stack traces |
| **Don't propagate noise** | Trim low-confidence findings (conf < 0.3), drop redundant context, compress large context |
| **Preserve temporal context** | Timestamps for all findings, mark time-sensitive info with TTL, note last update |
| **Maintain chain of custody** | Unique ID per handoff, full chain logged, traceable to source |
| **Validate on receive** | Format validation before accepting, missing fields → NACK with request |

### 19.5. Handoff Commands

```
/handoff create <from> <to>   Create manual handoff
/handoff send <json>          Send handoff directly
/handoff ack <id>             Acknowledge handoff
/handoff nack <id> <reason>   Reject handoff
/handoff list                 List all handoffs
/handoff trace <id>           Trace handoff chain
/handoff stats                Show handoff statistics
/handoff export <id>          Export handoff as JSON
/handoff retry <id>           Retry failed handoff
/handoff cleanup              Purge old handoffs
```

### 19.6. Handoff Chain Visualization

```
research ──A──▶ planner ──B──▶ implementer
  │                  │                     │
  │ C                │ D                  │ E
  ▼                  ▼                     ▼
wiki              reviewer ◀────── implementer

Chain: A → B → E → D → C
ID:   h001 h002 h003 h004 h005
Status: ✓  ✓  ✓  ✓  ✓
```

---

## 24. Plugin & Extension System

Users can extend the system without modifying core code. The plugin system follows a structured lifecycle with security checks.

### 20.1. Plugin Types

| Type | Description | Extension Point |
|------|-------------|-----------------|
| **Tool** | Custom function with input/output schema | `createTool()` in Mastra |
| **Skill** | Markdown-based behavioral instructions | `.skill.md` files |
| **MCP** | External MCP server config | MCP registry entry |
| **Worker** | Custom agent role with tools/memory | `agents/` directory |
| **Processor** | Transform input/output/error | `processors/` directory |
| **Layout** | Custom BSP tree layout preset | `layouts/` directory |
| **Memory** | Custom extractor/recall strategy | `memory/extractors/` |
| **Protocol** | Custom signal/action schema | `protocols/` directory |

### 20.2. Plugin Manifest Format

```typescript
interface PluginManifest {
  id: string;                    // Unique plugin identifier
  name: string;                  // Display name
  version: string;               // Semantic version (semver)
  type: 'tool' | 'skill' | 'mcp' | 'worker' | 'processor' | 'layout' | 'memory' | 'protocol';

  author: string;
  description: string;
  tags: string[];                // For discovery/search

  dependencies?: {
    mastra?: string;             // Mastra version compatibility
    node?: string;               // Node.js version requirement
    npm?: Record<string, string>; // Required npm packages
  };

  permissions?: string[];        // Required permissions
  sandbox?: {
    enabled: boolean;            // Run in sandbox?
    networkAccess?: boolean;     // Can access network?
    fileAccess?: 'read' | 'write' | 'full';
  };

  source: 'registry' | 'local' | 'url';
  url?: string;
  path?: string;
  installedAt: string;
  updatedAt: string;
  status: 'active' | 'inactive' | 'disabled' | 'error';
}
```

### 20.3. Plugin Lifecycle

```
install  →  verify  →  load  →  activate
  │         │        │        │
  ▼         ▼        ▼        ▼
registry  hash    manifest  runtime
download  check   parse     registration

update   →  verify  →  reload  →  activate
uninstall  →  cleanup  →  remove
disable    →  deactivate  →  freeze
```

### 20.4. Plugin Commands

```
/plugin install <id|url>      Install from registry/URL
/plugin install local <path>  Install from local path
/plugin update [id]           Update one or all plugins
/plugin uninstall <id>        Remove plugin
/plugin enable <id>           Enable plugin
/plugin disable <id>          Disable plugin
/plugin list                  List all plugins
/plugin info <id>             Show plugin details
/plugin search <query>        Search registry
/plugin verify <id>           Verify plugin integrity
/plugin categories            List available categories
/plugin export <id>           Export plugin as package
/plugin import <file>         Import plugin from file
/plugin health                Show plugin health status
/plugin logs <id>             Show plugin logs
```

### 20.5. Security Model

| Check | Description | Policy |
|-------|-------------|--------|
| Hash verification | SHA-256 of plugin source | Must match manifest |
| Permission check | Required vs. allowed permissions | User approval required |
| Sandbox | Isolated execution environment | Mandatory for network access |
| Version compatibility | Mastra version constraints | Block incompatible versions |
| Dependency validation | Required packages available | Auto-install or reject |
| Audit logging | All plugin actions logged | Always on |
| Rate limiting | Plugin tool call limits | Configurable per-plugin |

### 20.6. Plugin Discovery

```
Registry Search          Auto-Suggest             Manual Install
/plugin search           After task               /plugin install github:pkg
"security"               "Need?"                  After install:
Results:                                            registry add
• security-audit        1. Analyze task →         to available/
• cve-db                suggest relevant         Auto-load if
• sast-tools            2. Show preview          verified and in active/
3. User approves              4. Auto-load if
4. Install + verify             5. Load + activate
5. Load + activate
```

---

**END OF ARCHITECTURE DRAFT**
