# Glossary

Terms and definitions used across the wiki.

<!-- GROOM: Glossary maintained automatically -->

## Agent

A specialized AI worker with a fixed role (researcher, planner, reviewer, implementer, validator, monitor) and per-run tool customization.

## Orchestrator

The central agent that coordinates all workers through task decomposition, dispatch, and result synthesis.

## PlanDB

A task planning graph database that gives AI agents dependency tracking, atomic claiming, critical path analysis, and context surfacing.

## Neo4j Agent Memory

A graph-native memory system providing three layers: conversations (short-term), entities/facts (long-term), and reasoning traces (decision history).

## Knowledge Graph

A relational data structure storing entities, relationships, and properties that enables multi-hop reasoning across sessions.

## GROOM

Gated Refresh of Organizational Memory — a self-maintaining wiki system that triggers background maintenance when consulted.

## GROOM Operations

- **lint**: Fix formatting, links, style drift
- **prune**: Remove duplication, merge overlap
- **expand**: Web-research what changed
- **research**: Ingest recent arXiv work
- **iterate**: Find weakest page and improve it

## Herdr

A terminal multiplexer that provides real-time visibility into agent panes through BSP tree layouts and sidebar agent state reporting.

## AgentController

Mastra's mode-based session manager that replaces hand-rolled orchestration loops.

## Observational Memory (OM)

Mastra's auto memory compression system using Observer and Reflector background agents to compress conversation history.

## Background Task

A non-blocking async task that runs independently of the main agent stream, with suspend/resume capability.

## Signal

A typed message between agents (sendMessage, sendStateSignal, sendNotificationSignal).
