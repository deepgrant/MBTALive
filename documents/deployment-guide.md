# MBTA Tracker — Serverless AWS Deployment Guide

This is a clean production deployment. There is no ECS/ALB service, migration cutover, or rollback environment.

## Prerequisites

| Tool | Purpose |
|---|---|
| AWS CLI v1 or v2 | Bootstrap, ECR authentication, and frontend object uploads; Lambda invokes use the Java SDK |
| Docker Desktop with buildx | Building the arm64 Lambda image |
| JDK 21 | Scala and Lambda build |
| Node.js 20+ and npm | Angular build and tests |
| `unzip` | OpenTofu extraction; Gradle downloads OpenTofu automatically |

Configure and verify the AWS profile:

```bash
aws configure --profile <your-profile>
aws sts get-caller-identity --profile <your-profile>
```

## One-time bootstrap

### 1. Configure local AWS identity

```properties
# local.properties (gitignored)
aws.accountId=<your-account-id>
aws.profile=<your-profile>
```

### 2. Create the remote state bucket

```bash
./gradlew createStateBucket
```

This creates the versioned `<account-id>-tofu-state` S3 bucket. It is safe to rerun.

### 3. Upload deployment configuration

Review `deploy.json`, then run:

```bash
./gradlew uploadDeployConfig
```

The configuration is stored as `mbta-deploy-config` in Secrets Manager and is read in memory by deployment tasks.

### 4. Seed the MBTA key

```bash
export MBTA_API_KEY=<your-key>
./gradlew seedApiKey
```

The value is stored as `mbta-api-key`. Only MBTA-calling refresh Lambdas can read it. It is sent in the `x-api-key` header and never enters OpenTofu state, query strings, or logs. The route-activity Lambda cannot read it.

## Pre-deployment checks

Run these before the first rollout and before subsequent application releases:

```bash
./gradlew build
cd frontend && npm test -- --watch=false --browsers=ChromeHeadless
cd frontend && npm run build
cd ../infra && ../build/tools/tofu fmt -check -recursive && ../build/tools/tofu validate
```

Review the infrastructure plan:

```bash
./gradlew tofuPlan
```

The plan should contain only the serverless application: CloudFront, private frontend and snapshot buckets, Lambda functions, DynamoDB, Step Functions, EventBridge, the heartbeat API, ECR, IAM, logs, alarms, ACM, and Route 53.

## Production rollout

```bash
./gradlew --no-daemon deploy
```

The workflow performs these operations in order:

1. Creates the immutable snapshot ECR repository with a targeted OpenTofu apply.
2. Compiles Scala and assembles the Lambda runtime dependencies.
3. Builds and pushes a uniquely tagged Java 21/arm64 Lambda image.
4. Builds Angular independently.
5. Applies the complete OpenTofu stack, including the production CloudFront alias and Route 53 A/AAAA records.
6. Uploads hashed frontend assets with one-year immutable caching.
7. Uploads `index.html` and `version.json` with no-cache headers.
8. Seeds every route, stop, shape, and route-pattern reference snapshot.
9. Invokes the dedicated smoke Lambda and fails the deploy if seeding or smoke validation is not `ok`.

If deployment reached the seeding step but the local invocation failed, resume against the already deployed stack without rebuilding or applying infrastructure:

```bash
./gradlew smokeSnapshots
```

This reruns reference seeding and then smoke validation. These invocations use the AWS Java SDK directly and do not depend on the installed AWS CLI version.

ACM certificate validation can add several minutes to the first deployment. The certificate is always created in `us-east-1`, as required by CloudFront.

## Initial rollout validation

Show the deployed endpoints:

```bash
./gradlew tofuOutput
```

Verify the public contract through the production domain:

```bash
curl -fsS https://<your-domain>/api/routes
curl -fsS https://<your-domain>/api/status
curl -fsS -X PUT https://<your-domain>/api/control/routes/Red/activity
curl -fsS https://<your-domain>/api/route/Red/vehicles
curl -fsS https://<your-domain>/api/route/Red/board
```

Allow up to 15 seconds for newly activated vehicle data and 35 seconds for a newly activated board. Validate at least:

- Red, Orange, and a Green Line branch.
- One high-volume bus route.
- One commuter-rail route.
- A no-vehicle route and a disrupted-service route.

Then load-test 500 simulated clients for at least 30 minutes. Confirm in the `MBTA/Snapshots` CloudWatch namespace that increasing browser count does not increase MBTA request volume for the same distinct active routes and that no rolling 60-second interval exceeds 800 permits.

Required normal-operation targets:

- Vehicle snapshot age p95 below 20 seconds.
- Board snapshot age p95 below 45 seconds.
- Alerts below 3 minutes old.
- No MBTA `429` alarms.
- No Lambda, Step Functions, S3 publication, or heartbeat API alarms.
- `internal/*` snapshot objects remain inaccessible through CloudFront.

## Normal updates

For Lambda, frontend, or combined application changes, use the full immutable rollout:

```bash
./gradlew --no-daemon deploy
```

For infrastructure-only changes, preserve the image already recorded in OpenTofu state:

```bash
./gradlew infra
```

Do not run `tofuApply` directly for an infrastructure-only update: it expects the uniquely tagged image built during the current `deploy` invocation.

Hashed assets do not need invalidation. If an entry point must be purged explicitly:

```bash
./gradlew invalidateFrontendEntryPoints
```

This invalidates only `/`, `/index.html`, and `/version.json`.

## Local development

```bash
# Terminal 1
export MBTA_API_KEY=<your-key>
./gradlew snapshotDev

# Terminal 2
cd frontend && npm start
```

The Angular dev server proxies `/api/**` to the filesystem-backed snapshot server on `127.0.0.1:8080`.

## Teardown

```bash
./gradlew teardown
```

This destroys the application-managed CloudFront, S3, Lambda, DynamoDB, Step Functions, EventBridge, ECR, API Gateway, ACM, Route 53, IAM, logs, and alarms. The state bucket and Secrets Manager values are intentionally retained.

## Task reference

| Task | Purpose |
|---|---|
| `./gradlew deploy` | Complete production build, apply, upload, seed, and smoke workflow |
| `./gradlew infra` | Infrastructure-only apply using the currently deployed Lambda image |
| `./gradlew buildAndPushSnapshot` | Build and push the immutable Lambda image |
| `./gradlew tofuPlan` | Preview the complete infrastructure change |
| `./gradlew tofuOutput` | Show production outputs |
| `./gradlew invalidateFrontendEntryPoints` | Invalidate only non-immutable frontend entry points |
| `./gradlew teardown` | Destroy application infrastructure |
| `./gradlew createStateBucket` | Create the versioned remote state bucket |
| `./gradlew createEcrRepo` | Bootstrap the snapshot ECR repository |
| `./gradlew uploadDeployConfig` | Store `deploy.json` in Secrets Manager |
| `./gradlew seedApiKey` | Create the MBTA API key secret if absent |
