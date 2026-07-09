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

### 1.4. Communication Layer

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
| **Observational Memory** | Automatic summarization across threads for long-running sessions |

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

| Role | Base Instructions | Default Tools | Default Model | Herdr Pane |
|------|-------------------|---------------|---------------|------------|
| **🟣 Orchestrator** | Coordinate workers, make dispatch decisions, synthesize results | AgentController, Signals, Herdr CLI tools | Strong model (reasoning) | w1:p1 (always present) |
| **🔵 Researcher** | Gather info, search, analyze sources, build context | Web search, file read, code search | Balanced model | w1:p2 (on demand) |
| **🟡 Planner** | Decompose tasks, analyze dependencies, create strategy | File tree, code analysis, dependency graph | Balanced model | w1:p3 (on demand) |
| **🔴 Reviewer** | Review code from multiple angles (correctness, tests, security, performance) | File read, code search, diff analysis | Strong model | w1:p4 (on demand) |
| **🟢 Implementer** | Write/modify code, run tests, execute scripts | File write, bash execution, tool calling | Balanced model | w1:p5 (on demand) |
| **🟠 Validator** | Run tests, validate output, check acceptance criteria | Test runner, file read, output validation | Fast model | w1:t2:p1 (on demand) |
| **🔘 Monitor** | Watch worker states, manage Herdr layout, handle re-routing | Herdr CLI, pane read, agent status | Fast model | w1:t2:p2 (always present) |

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
│   └── worker-config.json        # Default worker configurations
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
│   │
│   └── herdr/
│       ├── layout-presets.json   # All BSP tree layout presets
│       ├── agent-states.ts       # Herdr ↔ Mastra state bridge
│       └── event-subscriber.ts   # Herdr event subscription manager
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

---

## 13. New Functionalities Added by This Architecture

### 13.1. AgentController Integration (vs. Hand-Rolled)

- **Modes** replace manual phase management: `plan` → `research` → `implement` → `review` → `validate`
- **Threads** provide persistent state across restarts with mode continuity
- **Event system** gives typed events for UI and Herdr integration without polling
- **Subagents** handle worker spawning with constrained tool sets
- **Observational memory** auto-summarizes long sessions

### 13.2. Signals Architecture

- **State signals** (`sendStateSignal`) replace manual output parsing for worker → orchestrator communication
- **Notification inbox** (`sendNotificationSignal`) for external events (CI, GitHub, Slack)
- **Reactive signals** from processors for context injection
- **Conditional attributes** (`ifActive`/`ifIdle`) for smart delivery routing

### 13.3. Background Task Lifecycle

- Workers are background tasks — orchestrator stream never blocks
- `untilIdle` auto-re-invokes orchestrator when workers complete
- **Suspend/resume** pattern for human approval flows
- **Lifecycle callbacks** for logging and notification
- **Per-tool timeout** and retry configuration
- **Manager-level streaming** for all task events

### 13.4. Herdr Layout Presets (BSP Trees)

- **Declarative layouts** saved as JSON trees, applied via `layout.apply()`
- **Presets per workflow** — each phase (research, implement, review) gets its own layout
- **Auto-restore** on session recovery
- **Dynamic resize** via `layout.set_split_ratio`
- **Export/save** current layout for learning/improvement

---

## 14. What This Architecture Gives Us

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

---

**END OF ARCHITECTURE DRAFT**
