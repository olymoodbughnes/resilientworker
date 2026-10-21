# ResilientWorker

[![CI](https://github.com/olymoodbughnes/resilientworker/actions/workflows/test.yml/badge.svg)](https://github.com/olymoodbughnes/resilientworker/actions)

A fault-tolerant background job processor built with **Node.js, TypeScript and PostgreSQL**.

ResilientWorker explores how background processing systems handle service failures, concurrent workers and unexpected crashes without losing track of jobs.

It uses simulated email delivery as a practical workload for demonstrating reliability engineering techniques.

## Features

- **Persistent job queue** — PostgreSQL stores jobs and their processing states.
- **Concurrency-safe claiming** — `SELECT ... FOR UPDATE SKIP LOCKED` allows workers to claim different jobs without processing the same job simultaneously.
- **Crash recovery** — stale processing jobs become eligible for reclamation.
- **Automatic retries** — transient failures trigger additional processing attempts.
- **Exponential backoff** — retries are delayed progressively to avoid overwhelming failing services.
- **Circuit breaker** — temporarily blocks requests when an external service repeatedly fails.
- **Dead-letter queue** — jobs that exhaust their attempts are retained for investigation.
- **Processing metrics** — tracks successes, failures, retries, circuit rejections and processing duration.
- **Automated testing** — Vitest tests run locally and through GitHub Actions.

## Technology

| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
| Language | TypeScript |
| Database | PostgreSQL 16 |
| Database driver | node-postgres (`pg`) |
| Local infrastructure | Docker Compose |
| Testing | Vitest |
| Continuous integration | GitHub Actions |

## Architecture

```text
          Job Producer
                |
                v
       PostgreSQL Job Queue
                |
                v
        Transactional Claim
        (SKIP LOCKED)
                |
                v
          Worker Process
                |
                v
          Circuit Breaker
                |
                v
       External Service Mock
                |
          +-----+------+
          |            |
        Success      Failure
          |            |
          v            v
       Complete    Retry / Backoff
                       |
                 Attempts exhausted
                       |
                       v
                Dead-Letter Queue

          Metrics and Logging
```

### Job lifecycle

1. A producer creates a job and stores it in PostgreSQL with `pending` status.
2. A worker claims an available job using a database transaction.
3. The worker attempts to execute the task.
4. Successful jobs are marked `completed`.
5. Transient failures trigger retries with exponential backoff.
6. Jobs that exhaust their retry attempts are moved to the dead-letter queue.
7. Stale processing jobs can be reclaimed after a worker failure.

Job records and attempt counts are stored in PostgreSQL rather than relying exclusively on process memory.

## Getting started

### Prerequisites

- Node.js and npm
- Docker with Docker Compose

### Installation

Clone the repository:

```bash
git clone https://github.com/olymoodbughnes/resilientworker.git
cd resilientworker
```

Install dependencies:

```bash
npm ci
```

Create your environment file using `.env.example`:

```env
DATABASE_URL=postgres://resilient:resilient@localhost:5432/resilientworker
```

Start PostgreSQL:

```bash
npm run db:up
```

Run the demonstration:

```bash
npm start
```

The application connects to PostgreSQL, prepares the task table, creates demonstration jobs and runs the worker.

The example deliberately simulates an unavailable email service to demonstrate retry handling, circuit breaking and dead-letter processing.

To stop the local database:

```bash
npm run db:down
```

Docker Compose uses a named volume to retain PostgreSQL data between ordinary container restarts.

## Reliability mechanisms

### Concurrent job claiming

ResilientWorker uses PostgreSQL transactions and `FOR UPDATE SKIP LOCKED`.

This prevents workers from claiming rows that are already locked by another transaction.

Concurrency tests use 20 dedicated PostgreSQL clients with overlapping transactions to check that claimed job IDs remain unique.

### Exponential backoff

Repeated failures result in progressively longer retry delays.

For example, the demonstration uses:

- First retry: 1 second
- Second retry: 2 seconds

This reduces immediate repeated requests to an unhealthy dependency.

### Circuit breaker

The circuit breaker tracks consecutive failures and can transition through:

- `CLOSED` — service requests are permitted.
- `OPEN` — requests are temporarily rejected.
- `HALF_OPEN` — a trial request checks whether the service has recovered.

Circuit rejections are counted separately in the metrics.

### Dead-letter queue

Jobs that exhaust their allowed attempts are moved to dead-letter storage.

Their original payload and attempt count remain available for troubleshooting rather than being silently discarded.

### Crash recovery

A job left in `processing` after a worker interruption can become claimable again once considered stale.

This prevents interrupted jobs from remaining permanently stuck.

## Observability

The worker reports:

| Metric | Purpose |
|--------|---------|
| Successes | Successfully completed tasks |
| Failures | Tasks that exhaust processing attempts |
| Retries | Additional attempts following failures |
| Circuit rejections | Requests blocked by the circuit breaker |
| Total processing time | Combined processing duration |
| Average processing time | Mean processing duration per processed task |

Metrics are reported in process logs and summarised after a demonstration run.

## Testing

Run the complete test suite:

```bash
npm test
```

Run unit tests only:

```bash
npm run test:unit
```

Run tests in watch mode:

```bash
npm run test:watch
```

### Test coverage

The test suite covers:

- PostgreSQL job persistence and lifecycle operations
- Concurrent job claiming across 20 database connections
- Recovery of stale processing jobs
- Successful worker execution
- Retry exhaustion and dead-letter handling
- Exponential backoff
- Circuit-breaker state transitions
- Processing metrics

**CI verification:** 13 passing tests across 5 test files.

### Continuous integration

GitHub Actions runs the test suite with PostgreSQL available as a service container.

This provides automated regression checks on repository changes.

[View GitHub Actions](https://github.com/olymoodbughnes/resilientworker/actions)

## Design considerations

ResilientWorker is a portfolio project focused on background-processing reliability rather than a hosted email service.

The external email dependency is simulated to make failure scenarios reproducible.

The implementation demonstrates durable job storage, concurrency coordination, retry policies, failure isolation, dead-letter handling and crash recovery.

It is not intended to guarantee exactly-once delivery. A worker can fail after performing an external side effect but before recording successful completion. Production integrations would therefore benefit from idempotency controls and appropriate operational monitoring.

## License

MIT — see [LICENSE](LICENSE).
