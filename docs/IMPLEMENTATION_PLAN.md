# Implementation Plan: Three-Strategy Paper Trading System

## Overview
This document outlines the implementation plan for a unified paper trading system with three strategies: Structural Parity, Cross-Market Relative Value, and Time-Based Mispricing.

## Files to Modify

### Core Infrastructure
1. **packages/market-discovery/src/mapping-service.ts** (NEW)
   - MappingService class with caching, versioning, confidence gating
   - Interface: getLatestMapping, getMappingAt, listRelationsByToken
   - Integration with existing MarketMatcher and MappingUpdater

2. **packages/signals/src/types.ts** (MODIFY)
   - Enhance Signal interface with: id, strategy, ttlMs, createdAt, rationale
   - Add OrderIntent interface with gated flag

3. **packages/signals/src/strategy-harness.ts** (MODIFY)
   - Update Signal interface usage
   - Add strategy identification

### Strategies
4. **packages/signals/src/parity-strategy.ts** (NEW/REFINE)
   - Strategy A: Structural Parity/Complement Constraints
   - Uses MappingService for complementPair and mutuallyExclusiveSet
   - Fallback to intra-market structure

5. **packages/signals/src/xrv-strategy.ts** (NEW)
   - Strategy B: Cross-Market Relative Value
   - Uses MappingService for equivalent and inverse relations
   - Relation throttling and error tracking

6. **packages/signals/src/time-mispricing-strategy.ts** (NEW/REFINE)
   - Strategy C: Time-Based Mispricing
   - Early market inefficiency (C1)
   - Pre-resolution overshoot (C2)
   - Optional mapping integration to avoid duplicate exposure

### Risk & Execution
7. **packages/risk/src/risk-gate.ts** (NEW)
   - Unified RiskGate interface wrapping RiskManager
   - Gate signals before execution
   - Return OrderIntent with gated flag

8. **packages/execution/src/paper-execution-sim.ts** (MODIFY)
   - Minor enhancements for slippage tracking
   - Ensure deterministic behavior with seed

### Experiment Framework
9. **packages/experiment/src/experiment-runner.ts** (NEW)
   - Unified runner for all strategies
   - Single MarketStateStore, RiskGate, PaperExecutionSim
   - Multi-strategy portfolio mode
   - Deterministic by seed

10. **packages/experiment/src/metrics.ts** (NEW)
    - Daily/weekly metrics computation
    - PnL, drawdown, turnover, hit rate, etc.
    - Per-relation stats for mapping-based strategies

11. **packages/experiment/src/reporter.ts** (NEW)
    - CLI summary tables
    - JSON output for plotting
    - Daily reports

### Storage
12. **packages/storage/prisma/schema.prisma** (MODIFY)
    - Add ExperimentRun, Signal, DailyStats, RelationStats tables
    - Include mappingVersion in signals

13. **packages/storage/src/repository.ts** (MODIFY)
    - Add methods for experiment data persistence

### Configuration
14. **packages/config/src/index.ts** (MODIFY)
    - Add mappingMinConfidence (default 0.80)
    - Add strategy-specific configs
    - Ensure SIMULATION_ONLY=true default

15. **.env.example** (NEW)
    - Template with all required configs

### CLI
16. **apps/bot/src/cli.ts** (MODIFY)
    - Add paper:run commands
    - Add backtest:run commands
    - Add mapping refresh commands

## Files to Add

### New Packages
- **packages/experiment/** (NEW PACKAGE)
  - experiment-runner.ts
  - metrics.ts
  - reporter.ts
  - index.ts
  - package.json
  - tsconfig.json

## Files to Delete
- None (refining existing code)

## Implementation Order

1. **Phase 1: Core Infrastructure**
   - MappingService
   - Enhanced Signal types
   - RiskGate interface

2. **Phase 2: Strategies**
   - Strategy A (Parity)
   - Strategy B (XRV)
   - Strategy C (Time)

3. **Phase 3: Experiment Framework**
   - ExperimentRunner
   - Metrics computation
   - Reporter

4. **Phase 4: Integration & Testing**
   - CLI integration
   - Database schema updates
   - Unit tests
   - End-to-end tests

## Key Design Decisions

1. **LONG-ONLY Mode**: All strategies support LONG-ONLY mode (no shorting) as default, with logging of short opportunities for analysis.

2. **Mapping Versioning**: Each mapping result has a version hash (mapping outputs + prompt version + timestamp bucket) for reproducibility.

3. **Confidence Gating**: Only use mapping relations with confidence >= mappingMinConfidence (default 0.80).

4. **Deterministic Execution**: Use RNG seed for passive fill simulation to ensure reproducible backtests.

5. **Unified State**: All strategies share the same MarketStateStore, RiskGate, and PaperExecutionSim for fair comparison.

## Testing Strategy

1. **Unit Tests**:
   - MappingService: caching, versioning, confidence filtering
   - Each strategy: signal generation logic
   - RiskGate: blocking logic
   - PaperExecutionSim: fill simulation

2. **Integration Tests**:
   - End-to-end paper trading run
   - Multi-strategy portfolio mode
   - Mapping refresh and staleness handling

3. **Validation Tests**:
   - Orderbook delta correctness (if WS deltas exist)
   - Mapping integration correctness
   - Risk gate blocks when limits tripped

