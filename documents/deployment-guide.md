# MBTA Tracker — AWS Deployment Guide

## Prerequisites

Ensure the following are installed and configured locally:

| Tool | Purpose |
|---|---|
| AWS CLI v2 | All cloud operations |
| Docker Desktop | Building and pushing images |
| JDK 17+ | Gradle / Scala build |
| Node.js 20+ / npm | Angular frontend build |
| `unzip` | OpenTofu extraction (Gradle downloads tofu automatically) |

Configure the `grant` AWS profile:
```bash
aws configure --profile grant
# Enter: Access Key ID, Secret Access Key, default region: us-east-1, output: json
```

Verify access:
```bash
aws sts get-caller-identity --profile grant
```

---

## One-Time Bootstrap

### 1. Configure local identity

```bash
cat >> local.properties <<'EOF'
aws.accountId=533972452432
aws.profile=grant
EOF
```

> `local.properties` is gitignored — never commit it.

### 2. Create OpenTofu remote state backend

```bash
./gradlew createStateBucket
```

Creates S3 bucket `533972452432-tofu-state` with versioning enabled for OpenTofu state storage. Idempotent — safe to re-run.

### 3. Upload deploy config to Secrets Manager

```bash
./gradlew uploadDeployConfig
```

Pushes `deploy.json` to AWS Secrets Manager as `mbta-deploy-config`. All subsequent deploy tasks read config from here in-memory — nothing is written to disk.

### 4. Seed the MBTA API key

```bash
export MBTA_API_KEY=your-api-key-here
./gradlew seedApiKey
```

The key is stored in Secrets Manager as `mbta-api-key`. The ECS task pulls it at runtime; it never appears in OpenTofu state or logs.

### 5. Provision infrastructure

```bash
./gradlew infra
```

This runs `tofu apply` and creates (in order):

- ECR repository for Docker images
- ECS cluster, task definition, and Fargate service
- Application Load Balancer (HTTP, internal to API Gateway)
- API Gateway HTTP API with custom domain `critmind.com`
- ACM TLS certificate for `critmind.com` (DNS-validated automatically via Route 53)
- Route 53 A record → API Gateway regional endpoint

> **Note:** ACM certificate validation takes 1–5 minutes. OpenTofu waits for it automatically before completing.

### 6. Authenticate Docker to ECR

```bash
./gradlew configureDockerAuth
```

Configures the Docker credential helper for the ECR registry. Must be run after `infra` (ECR repo must exist first). Re-run whenever credentials expire (~12 hours).

### 7. Full application deploy

```bash
./gradlew --no-daemon deploy
```

This runs the full pipeline in the correct order:
1. `createEcrRepo` — targeted tofu apply that creates just the ECR repository
2. `npm ci && npm run build --base-href /MBTA/` — Angular production build
3. Gradle Scala compile + `copyRuntimeDeps` — assembles JARs
4. `docker` — builds `mbtalive:2.0` image with JARs and Angular assets at `/app/static/`
5. `tagImage` / `pushImage` / `pushLatest` — tags with git SHA and pushes to ECR
6. `tofuApply` — provisions all remaining infrastructure (ECS, ALB, API Gateway, etc.) with the correct image URL

> **Note:** `createEcrRepo` runs as a targeted apply so the ECR repo exists before the image push. After a `teardown`, always use `deploy` rather than `infra` then `buildAndPush` separately.

---

## Verifying the Deployment

```bash
# Show all infrastructure outputs
./gradlew tofuOutput

# Check ECS service health
./gradlew ecsStatus

# Smoke test the health endpoint
curl https://critmind.com/MBTA/health

# Test an API endpoint
curl https://critmind.com/MBTA/api/routes
```

The app is accessible at:
- **`https://critmind.com/MBTA/`** — Angular frontend (served by Pekko from `/app/static/`)
- **`https://critmind.com/mbta/`** — lowercase alias (same backend)
- **`https://critmind.com/MBTA/api/*`** — backend API routes

> The `/MBTA` prefix is stripped by the API Gateway custom domain mapping before requests reach the container, so Pekko sees clean paths (`/api/routes`, `/health`, `/`).

---

## Normal Deploy Workflow

```bash
# Full deploy (most common — builds everything and redeploys)
./gradlew deploy

# Infrastructure changes only (no image rebuild)
./gradlew infra

# Image rebuild only, then force new ECS deployment
./gradlew buildAndPush tofuApply

# Preview infrastructure changes before applying
./gradlew tofuPlan
```

---

## Upgrading the Running Container

To deploy new Scala or Angular code without changing infrastructure:

```bash
./gradlew --no-daemon buildAndPush tofuApply
```

What this does:
1. `buildAndPush` — builds the Angular frontend, compiles Scala, builds a new Docker image tagged with the current git SHA, and pushes it to ECR
2. `tofuApply` — updates the ECS task definition with the new image URL, triggering a rolling replacement

ECS starts a new task with the updated image, waits for it to pass the `/health` check, then drains and terminates the old task. No downtime.

To stage the image push separately from the infra update:

```bash
# Build and push first
./gradlew --no-daemon buildAndPush

# Apply when ready
./gradlew --no-daemon tofuApply
```

---

## Local Development

Local dev is unchanged — the `/MBTA` prefix only applies in production. The Angular dev server proxies `/api/**` directly to `localhost:8080`.

```bash
# Terminal 1 — backend
./gradlew run

# Terminal 2 — frontend (dev server at http://localhost:4200)
cd frontend && npm start
```

---

## Teardown

```bash
# Destroy all AWS infrastructure
./gradlew teardown
```

> **Warning:** This destroys the ECS service, ALB, API Gateway, ECR repository (including all images), ACM cert, and Route 53 records. The Secrets Manager secrets and S3 state bucket are **not** destroyed (intentional — protects state and credentials from accidental loss). Delete them manually if needed:
> ```bash
> aws secretsmanager delete-secret --secret-id mbta-api-key --profile grant --region us-east-1
> aws secretsmanager delete-secret --secret-id mbta-deploy-config --profile grant --region us-east-1
> aws s3 rb s3://533972452432-tofu-state --force --profile grant
> ```

---

## Gradle Task Reference

| Task | Group | Description |
|---|---|---|
| `./gradlew deploy` | deploy | Full pipeline: build → push → apply infra |
| `./gradlew infra` | deploy | Infrastructure only (no image rebuild) |
| `./gradlew buildAndPush` | deploy | Build and push image only |
| `./gradlew tofuPlan` | deploy | Preview infrastructure changes |
| `./gradlew tofuOutput` | deploy | Show all outputs (ALB DNS, ECR URL, etc.) |
| `./gradlew ecsStatus` | deploy | Running task count and service health |
| `./gradlew teardown` | deploy | Destroy all infrastructure |
| `./gradlew createStateBucket` | deploy-setup | Create S3 state bucket (idempotent) |
| `./gradlew createEcrRepo` | deploy-setup | Create ECR repository only (targeted tofu apply) |
| `./gradlew uploadDeployConfig` | deploy-setup | Push `deploy.json` to Secrets Manager |
| `./gradlew seedApiKey` | deploy-setup | Seed MBTA API key (skips if exists) |
| `./gradlew configureDockerAuth` | deploy-setup | Authenticate Docker to ECR |
