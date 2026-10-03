# TRUEIRIS — MASTER IMPLEMENTATION BRIEF

You are the primary software engineering agent responsible for designing and implementing **TrueIris**, a hackathon project.

You are expected to behave like a senior full-stack / AI engineer working autonomously inside the repository.

Do not merely generate example code or describe what should be done. Inspect the repository, implement the project, run it, test it, fix failures, and leave the repository in a working state after every feature.

---

# 1. OPERATING RULES

## 1.1 Repository-first behavior

Before making substantial changes:

1. Inspect the entire repository structure.
2. Read:
   - README files
   - package manifests
   - TypeScript configs
   - Electron configuration
   - environment templates
   - database migrations
   - existing architecture
   - tests
   - CI/CD configuration
   - `.gitignore`
3. Determine what already exists.
4. Preserve working architecture unless there is a strong technical reason to change it.
5. Do not duplicate functionality that is already implemented.
6. Prefer incremental, reviewable changes over giant rewrites.

If this is an empty repository, bootstrap the project according to this specification.

---

# 2. GITHUB COPILOT COLLABORATION

If GitHub Copilot is available to you through the IDE, terminal, agent environment, GitHub tooling, or another accessible interface, use it as a secondary engineering assistant where useful.

Appropriate uses include:

- asking Copilot for a second implementation approach
- reviewing a difficult function
- generating routine boilerplate
- reviewing TypeScript types
- suggesting tests
- debugging platform-specific Electron issues
- reviewing SQL queries
- reviewing React components
- checking edge cases

You remain the primary engineer and must independently verify all Copilot suggestions.

Never blindly paste Copilot output.

Before accepting Copilot-generated code:

1. inspect it
2. ensure it matches the architecture
3. ensure it is type-safe
4. ensure it does not expose secrets
5. test it
6. modify it where necessary

If Copilot is not available in the environment, continue normally without blocking or repeatedly attempting to access it.

---

# 3. CRITICAL GIT WORKFLOW

This rule is mandatory.

## AFTER EVERY COMPLETED FEATURE:

Perform all of the following before starting the next feature:

1. run formatting
2. run linting
3. run TypeScript type checking
4. run relevant unit/integration tests
5. run the relevant application build
6. manually inspect the resulting diff
7. fix any failure introduced by the feature
8. update documentation if architecture, configuration, setup, or environment variables changed
9. commit the completed feature
10. push the commit to the remote repository

Do not combine multiple completed features into one giant commit.

Use clear conventional-style commit messages where practical.

Examples:

```text
feat(sensor): integrate Presage realtime measurements
feat(timeline): add physiological history visualization
feat(context): detect active desktop application
feat(ai): add Gemini tool-calling agent
feat(memory): implement semantic episode retrieval
feat(voice): integrate ElevenLabs realtime conversation
fix(sensor): handle low-confidence Presage readings
test(agent): cover physiological baseline queries
```

A feature is not considered finished until its commit has been created and successfully pushed.

After each push, verify:

```bash
git status
```

The working tree should normally be clean before beginning the next feature.

Do not commit:

- `.env`
- API secrets
- credentials
- tokens
- generated dependency folders
- private user data
- raw webcam captures
- raw screenshots

If Git authentication or repository permissions prevent pushing:

- preserve the completed local commit
- clearly report the exact Git error
- do not discard the work
- continue only if doing so does not risk losing or confusing commit history
- retry the push when access becomes available

Never force-push unless explicitly instructed.

---

# 4. PROJECT GOAL

TrueIris is a **personal context intelligence system**.

It observes the user's physiological state and computer activity, creates a timestamped memory of the user's day, learns personalized baselines and patterns, and allows the user to query those patterns conversationally.

The system should follow this conceptual loop:

```text
OBSERVE
   ↓
CONTEXTUALIZE
   ↓
COMPARE TO PERSONAL BASELINES
   ↓
RETRIEVE RELEVANT HISTORY
   ↓
REASON
   ↓
RESPOND / RECOMMEND
   ↓
OBSERVE WHAT HAPPENS NEXT
```

TrueIris should feel like an embedded intelligence system, not a dashboard with a generic chatbot attached.

---

# 5. HACKATHON OBJECTIVES

The project should meaningfully demonstrate:

- Presage SmartSpectra
- Gemini API
- Tiger Data / TimescaleDB
- ElevenLabs
- Vultr
- high-quality product design

The integrations must be foundational rather than decorative.

The 90-second live demo should be understandable without technical explanation.

---

# 6. PRODUCT PRINCIPLES

Prioritize:

1. reliable demo behavior
2. first-party data
3. realtime interaction
4. evidence-based AI responses
5. personalized comparisons
6. privacy-conscious processing
7. polished visual design
8. graceful degradation when APIs fail

Avoid unnecessary web scraping.

TrueIris should primarily derive intelligence from:

- webcam sensor measurements
- OS activity
- user-entered information
- transient visual understanding
- time-series history
- semantic memory
- voice interaction

Do not build a web crawler.

---

# 7. HIGH-LEVEL ARCHITECTURE

Target architecture:

```text
┌─────────────────────────────────────────────┐
│        TRUEIRIS ELECTRON APPLICATION       │
│                                             │
│ React + TypeScript                         │
│                                             │
│ Webcam ──────── Presage SmartSpectra       │
│                       │                     │
│                       ├ pulse               │
│                       ├ respiration         │
│                       ├ HRV                 │
│                       ├ talking             │
│                       └ signal confidence   │
│                                             │
│ Desktop Context Engine                     │
│                       ├ active application  │
│                       ├ idle state          │
│                       ├ session context     │
│                       └ optional screenshot │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
             Event Processor
                   │
                   ▼
          Tiger Data / PostgreSQL
           TimescaleDB + vectors
                   │
        ┌──────────┴───────────┐
        ▼                      ▼
    Analytics             Semantic Memory
        │                      │
        └──────────┬───────────┘
                   ▼
              Gemini Agent
             tool/function calls
                   │
                   ▼
          TrueIris Reasoning Layer
                   │
             ElevenLabs Voice
```

Backend orchestration should be deployable to Vultr using Docker.

---

# 8. PREFERRED TECHNOLOGY STACK

Unless the repository already establishes equivalent technologies, prefer:

## Desktop

- Electron
- React
- TypeScript
- Vite

## UI

- Tailwind CSS
- shadcn/ui where useful
- Recharts or Visx
- Zustand
- Zod

## Backend

- Node.js
- TypeScript
- Fastify
- WebSockets where realtime communication benefits from them

## Database

- PostgreSQL
- Tiger Data / Tiger Cloud
- TimescaleDB
- vector extension / pgvector-compatible vector storage

## AI

- Gemini API
- structured outputs
- Gemini function calling
- embeddings where appropriate

## Physiological sensing

- Presage SmartSpectra Node/Electron SDK

## Voice

- ElevenLabs realtime speech-to-text
- ElevenLabs streaming text-to-speech

## Infrastructure

- Vultr
- Docker
- Docker Compose where useful
- Nginx or Caddy if a reverse proxy is needed

## Engineering

- ESLint
- Prettier
- Vitest
- Playwright where UI testing is practical

Use one language—preferably TypeScript—across as much of the stack as practical.

---

# 9. MONOREPO STRUCTURE

If starting from scratch, prefer an organization similar to:

```text
trueiris/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   ├── preload/
│   │   │   └── renderer/
│   │   └── package.json
│   │
│   └── api/
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── agents/
│       │   ├── tools/
│       │   └── websocket/
│       └── package.json
│
├── packages/
│   ├── shared/
│   ├── schemas/
│   ├── db/
│   └── analytics/
│
├── migrations/
├── scripts/
├── docker/
├── docs/
├── .env.example
├── docker-compose.yml
└── README.md
```

Do not force this structure onto an established repository if an equivalent clean structure already exists.

---

# 10. ENVIRONMENT CONFIGURATION

Maintain a complete `.env.example`.

Expected variables may include:

```text
PRESAGE_API_KEY=

GEMINI_API_KEY=

ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

DATABASE_URL=

TRUEIRIS_API_URL=

VULTR_DEPLOYMENT_ENV=
```

Never expose private API credentials directly to the React renderer when they can instead be protected through Electron main/preload or the backend.

Prefer short-lived credentials where supported.

---

# 11. DATA PIPELINE

Implement three levels of physiological information.

## Level 1 — realtime transient signal

Used for fluid UI.

Examples:

```text
pulse
breathing waveform
measurement confidence
face availability
```

Do not persist every render-level sample.

---

## Level 2 — persisted measurements

Store roughly one meaningful sample per second unless SDK characteristics indicate a better interval.

Example:

```text
15:32:01 pulse=74 breathing=14.1 HRV=41
15:32:02 pulse=74 breathing=14.1 HRV=41
15:32:03 pulse=75 breathing=14.0 HRV=40
```

---

## Level 3 — reasoning epochs

Aggregate measurements into approximately 30–60 second periods.

Example:

```json
{
  "start": "2026-10-03T15:32:00-05:00",
  "end": "2026-10-03T15:33:00-05:00",
  "meanPulse": 74.2,
  "meanRespiration": 14.1,
  "meanHrv": 40.5,
  "pulseVariance": 2.1,
  "activity": "coding",
  "application": "Visual Studio Code",
  "confidence": 0.91
}
```

Gemini should normally reason over epochs and aggregates rather than thousands of individual measurements.

---

# 12. DATABASE MODEL

Create schema/migrations for at least:

## measurements

```text
timestamp
user_id
session_id
pulse_rate
pulse_confidence
breathing_rate
breathing_confidence
hrv_rmssd
hrv_confidence
talking
signal_quality
```

## context_events

```text
id
start_time
end_time
user_id
application
window_title
activity
semantic_context
source
confidence
```

## epochs

```text
id
start_time
end_time
user_id
mean_pulse
mean_breathing
mean_hrv
pulse_variance
activity
context_event_id
signal_quality
```

## insights

```text
id
timestamp
user_id
insight_type
description
evidence_json
confidence
```

## journal_entries

```text
id
timestamp
user_id
text
embedding
tags
```

## memories

```text
id
start_time
end_time
user_id
summary
embedding
metadata_json
```

## experiments

```text
id
user_id
title
hypothesis
metric_definition
status
created_at
```

## experiment_sessions

```text
id
experiment_id
condition
start_time
end_time
metrics_json
user_rating
notes
```

Use Timescale hypertables for appropriate timestamp-heavy tables.

Add useful indexes.

Use continuous aggregates where appropriate for:

- minute summaries
- 15-minute summaries
- hourly summaries
- daily summaries
- activity-level summaries

---

# 13. FEATURE 1 — APPLICATION FOUNDATION

Create or validate the Electron + React + TypeScript application.

Requirements:

- Electron main process
- secure preload layer
- React renderer
- strict TypeScript
- development mode
- production build
- environment validation
- basic routing
- error boundary
- application logging
- health/status indicator

Create the initial design system.

Run:

```bash
lint
typecheck
test
build
```

Then commit and push before continuing.

---

# 14. FEATURE 2 — PRESAGE SENSOR INTEGRATION

Integrate Presage SmartSpectra.

Primary success condition:

```text
webcam
→ Presage
→ valid realtime pulse measurement
→ visible TrueIris UI
```

Support available relevant measurements such as:

- pulse rate
- respiration
- HRV
- talking state
- blinking if useful
- signal quality / confidence indicators

Create a typed internal sensor event format.

Example:

```ts
type SensorReading = {
  timestamp: string;
  pulseRate?: number;
  pulseConfidence?: number;
  respirationRate?: number;
  respirationConfidence?: number;
  hrvRmssd?: number;
  hrvConfidence?: number;
  talking?: boolean;
  signalQuality: "excellent" | "good" | "poor" | "unavailable";
};
```

Gracefully handle:

- no camera
- camera permission denied
- face not found
- poor lighting
- excessive motion
- talking
- unstable readings
- API failure

Do not represent low-confidence values as authoritative.

Add a development/mock sensor provider so the UI remains testable without Presage credentials.

Test.

Commit and push.

---

# 15. FEATURE 3 — LIVE VIEW

Build the main live physiological interface.

Show prominently:

```text
Pulse
Respiration
HRV
Signal confidence
Current activity
Current application
Session duration
```

UI should feel premium and minimal.

Provide subtle realtime motion.

Do not create a noisy clinical dashboard.

Create clear states:

```text
Excellent signal
Good signal
Low confidence
Calibrating
No face detected
Camera unavailable
```

Test responsive behavior and realtime updates.

Commit and push.

---

# 16. FEATURE 4 — TIGER DATA INGESTION

Create the persistence layer.

Pipeline:

```text
Presage event
→ normalize
→ optionally smooth
→ store measurement
→ generate epoch
→ persist aggregate
```

Implement:

- batching where useful
- retries
- duplicate protection
- connection health
- timestamps handled consistently
- database error handling

Build tests around serialization and epoch calculation.

Commit and push.

---

# 17. FEATURE 5 — TIMELINE

Create the Today timeline.

Show:

- activity periods
- pulse
- respiration
- HRV
- context changes
- signal gaps

Allow selecting a region.

Example:

```text
9 AM ───────────────────────── 5 PM

████ Study
     ███ Class
         █████ Coding
               ██ Lunch
                  █████ Coding
```

Overlay physiological trends without making the visualization unreadable.

Selecting a point or period should expose contextual details.

Commit and push.

---

# 18. FEATURE 6 — DESKTOP CONTEXT ENGINE

Add first-party computer context.

Capture where supported:

- foreground application
- application switching
- idle duration
- session duration
- optional window title
- manually selected activity
- focus-mode state

Do not scrape webpage DOM contents.

Do not install invasive browser scraping.

Create an activity classifier abstraction:

```ts
classifyActivity({
  application,
  windowTitle,
  previousActivity,
  timeOfDay
})
```

Possible output:

```json
{
  "activity": "coding",
  "confidence": 0.89,
  "reason": "VS Code foreground for 18 minutes"
}
```

Persist context intervals.

Commit and push.

---

# 19. FEATURE 7 — OPTIONAL SCREEN CONTEXT

This feature must be privacy-conscious.

Only implement screen understanding behind explicit opt-in.

Possible flow:

```text
temporary screenshot
→ downscale
→ Gemini multimodal analysis
→ structured activity description
→ discard screenshot
→ retain classification only
```

Expected structured response:

```json
{
  "activity": "coding",
  "task": "debugging a TypeScript project",
  "application": "VS Code",
  "cognitiveMode": "focused work",
  "confidence": 0.94
}
```

Requirements:

- visible permission state
- clear indication when screen understanding is active
- configurable cadence
- no screenshot persistence by default
- never log screenshot pixels
- no silent capture

If the feature cannot be implemented safely or reliably before demo readiness, keep it behind a feature flag.

Commit and push.

---

# 20. FEATURE 8 — PERSONAL BASELINES

Implement personalized historical comparison.

Do NOT hard-code simplistic medical interpretations such as:

```text
90 BPM = stressed
```

Instead calculate contextual baselines.

Examples:

```text
typical coding pulse
typical coding HRV
typical morning pulse
typical afternoon respiration
typical first 10 minutes of a focus session
```

Expose analytics functions such as:

```ts
getActivityBaseline()
getTimeOfDayBaseline()
compareAgainstBaseline()
getBaselineDeviation()
```

Example result:

```json
{
  "metric": "pulse",
  "current": 81,
  "baseline": 72,
  "differenceAbsolute": 9,
  "differencePercent": 12.5,
  "context": "coding",
  "sampleCount": 18,
  "confidence": 0.88
}
```

The system must communicate when historical sample size is inadequate.

Commit and push.

---

# 21. FEATURE 9 — GEMINI TOOL-CALLING AGENT

Gemini must operate as an agent over reliable application tools.

Do not send the database wholesale into prompts.

Implement explicit tools such as:

```text
get_current_state()

get_metrics(
  start,
  end,
  metric
)

get_context(
  start,
  end
)

compare_baseline(
  metric,
  activity,
  time_range
)

get_daily_summary(
  date
)

find_similar_sessions(
  description,
  limit
)

search_memories(
  query,
  limit
)
```

Every numerical factual claim made by Iris should ideally trace back to tool output.

Gemini should decide what tools are needed.

Support multi-step questions.

Examples:

```text
When was my pulse lowest today?

When was I most physiologically settled today?

Compare this coding session with yesterday's.

What changed after lunch?

Is this session unusual for me?

Explain the last 30 minutes.
```

Use structured schemas and Zod validation for tool inputs and outputs.

Never trust arbitrary model-generated SQL.

Commit and push.

---

# 22. FEATURE 10 — "EXPLAIN THE LAST 30 MINUTES"

This is a critical demo feature.

Implement:

```text
"Iris, explain the last 30 minutes."
```

The agent should typically retrieve:

```text
metrics
context
baseline comparisons
relevant historical sessions
```

Then create an evidence-grounded narrative.

Example style:

```text
You spent most of the last 30 minutes in VS Code.

Your pulse began roughly 12% above your usual coding
baseline and moved closer to it after about nine minutes.

Your breathing remained comparatively stable.

This pattern resembles two coding sessions from earlier
this week where the first several minutes were more
elevated than the remainder.
```

Highlight the corresponding timeline region while Iris is explaining it.

Avoid diagnoses.

Commit and push.

---

# 23. FEATURE 11 — SEMANTIC EPISODIC MEMORY

Create episodic memories from meaningful sessions.

At session completion, generate an evidence-grounded summary.

Example:

```text
52-minute coding session working on authentication.
Pulse began elevated relative to the user's coding baseline
and stabilized after approximately 12 minutes.
User reported difficulty starting but strong focus afterward.
```

Generate an embedding.

Store:

```text
summary
embedding
timestamp
activity
metrics
context
metadata
```

Implement semantic retrieval.

Example user question:

```text
When have I had a session like this before?
```

Return similar historical episodes with similarity plus factual metadata.

Commit and push.

---

# 24. FEATURE 12 — ELEVENLABS VOICE

Implement the full conversational voice loop:

```text
Microphone
→ ElevenLabs realtime STT
→ transcript
→ Gemini agent
→ tool calls
→ response text
→ ElevenLabs streaming TTS
```

Requirements:

- partial transcript display
- final transcript
- clear listening state
- clear reasoning/loading state
- streamed spoken response
- interruption handling if feasible
- text fallback

Do not expose ElevenLabs secrets in the renderer.

Commit and push.

---

# 25. FEATURE 13 — ASK IRIS

Create a polished voice-first conversational page.

Suggested starter prompts:

```text
When was I most focused today?

Compare today with yesterday.

What usually happens after lunch?

Explain the last 30 minutes.

Find days similar to today.

How does this session compare with my normal coding sessions?
```

Show tool-derived supporting evidence without exposing hidden model reasoning.

Provide compact evidence cards:

```text
Source period
Metric
Baseline
Difference
Similar sessions
```

Commit and push.

---

# 26. FEATURE 14 — PATTERNS

Create a Patterns view.

Examples:

```text
DEEP WORK

Your longest recent work sessions tended to begin
between 9:00 AM and 11:00 AM.
```

```text
CODING

Your pulse has typically moved closer to your coding
baseline after approximately 11 minutes.
```

```text
BREAKS

Four of five recent long sessions followed by a short
walking break showed measurements moving closer to
their previous baseline range.
```

Every insight should contain evidence.

Represent uncertainty.

Do not overstate correlation as causation.

Commit and push.

---

# 27. FEATURE 15 — FOCUS MODE

Allow:

```text
"Iris, I'm going to work on TrueIris for 45 minutes."
```

Create a focus session.

Show:

```text
Goal
Elapsed time
Current physiology
Comparison with personal baseline
Application
Context switches
Focus streak
```

Record context switches.

Do not make manipulative productivity claims.

At completion, summarize the session.

Commit and push.

---

# 28. FEATURE 16 — EVENT RECONSTRUCTION

Allow the user to click a timeline range and ask:

```text
What happened here?
```

Build an event reconstruction from first-party observations.

Example:

```text
3:12 PM
Opened VS Code

3:15 PM
Started authentication work

3:17 PM
Pulse increased relative to coding baseline

3:19 PM
Several application switches

3:25 PM
Measurements moved closer to baseline
```

Then Gemini generates a concise narrative.

Commit and push.

---

# 29. FEATURE 17 — PERSONAL EXPERIMENTS

Implement lightweight N-of-1 experiments.

Examples:

```text
Does music improve my focus?

Do I work differently in the morning?

What happens when I walk before coding?

Do short breaks change my later sessions?
```

Experiment definition should include:

```text
hypothesis
conditions
measurement criteria
minimum sessions
optional user rating
status
```

Example:

```text
Experiment:
Music vs No Music

Measures:
session duration
self-reported focus
pulse deviation from baseline
HRV deviation from baseline

Target:
7 sessions
```

Results must distinguish:

- observed association
- insufficient data
- meaningful difference
- no meaningful difference

Never present weak observational evidence as medical or scientific certainty.

Commit and push.

---

# 30. FEATURE 18 — PROACTIVE INSIGHT ENGINE

Build a conservative proactive insight layer.

Example logic:

```text
coding duration: 74 minutes

current pulse:
+15% relative to user's coding baseline

current HRV:
-21% relative to user's coding baseline

similar historical sessions:
5

following short break:
4/5 subsequently moved closer to baseline
```

Potential suggestion:

```text
You've been coding for 74 minutes, and this resembles
several of your longer sessions this week.

After four of five similar sessions followed by a short
break, your readings moved closer to your usual range.

Would you like to start a 10-minute reset?
```

Rules:

- personalization over generic advice
- evidence required
- no diagnosis
- no alarmist wording
- user must remain in control
- avoid excessive notifications

Commit and push.

---

# 31. FEATURE 19 — DEMO DATA SYSTEM

Implement safe, clearly separated seeded historical data.

The demo should combine:

```text
REAL:
current webcam measurements

REAL:
current desktop context

SEEDED:
previous several days of history
```

Seed enough data to demonstrate:

- activity baselines
- coding patterns
- daily comparisons
- semantic memory
- similar sessions
- experimentation
- pattern cards

Do not pretend seeded data is genuine user history internally.

Mark records with a source field such as:

```text
source = demo_seed
```

Create scripts:

```bash
pnpm seed:demo
pnpm seed:clear
```

Use deterministic/random-seeded generation where practical.

Commit and push.

---

# 32. FEATURE 20 — DEMO MODE

Create an explicit demo configuration:

```text
TRUEIRIS_DEMO_MODE=true
```

Demo mode should maximize reliability.

Requirements:

- seeded historical data automatically available
- current Presage reading remains real when available
- graceful fallback to mock realtime sensor if Presage fails
- predictable example questions
- clear API health indicators outside the presentation view
- no accidental secret exposure

Do not display distracting developer controls during the presentation.

Commit and push.

---

# 33. FEATURE 21 — VULTR DEPLOYMENT

Containerize backend components.

Provide:

```text
Dockerfile
docker-compose.yml if useful
deployment documentation
health endpoint
environment configuration
```

Expected Vultr deployment:

```text
Vultr VM
│
├── Fastify API
├── WebSocket service
├── Gemini orchestration
├── ElevenLabs token/proxy logic
└── analytics workers
```

Do not add GPU inference solely to claim GPU usage.

If there is no technically justified local model, keep Gemini as the reasoning engine.

Commit and push.

---

# 34. FEATURE 22 — OBSERVABILITY

Add enough observability to debug the live demo.

Provide structured logs for:

```text
sensor connected
sensor disconnected
database connected
database error
Gemini request
Gemini tool invocation
ElevenLabs connection
voice latency
context activity change
epoch generated
```

Never log:

- API keys
- raw audio
- screenshots
- personally sensitive freeform content unless necessary

Provide a hidden/developer diagnostics panel if useful.

Commit and push.

---

# 35. FEATURE 23 — PRIVACY CONTROLS

Implement clear settings for:

```text
Camera sensing
Desktop context
Screen understanding
Voice
Data retention
Demo mode
```

Screen understanding must be visibly opt-in.

Make architecture privacy-aware.

Document:

```text
What is captured
What is persisted
What is transient
What is sent externally
```

Commit and push.

---

# 36. PRODUCT UI

The primary navigation should include approximately:

```text
Live
Timeline
Patterns
Ask Iris
Experiments
Settings
```

Do not overload the navigation.

---

# 37. LIVE VIEW DESIGN

Target:

```text
                  74
                  BPM

          [ camera / visualizer ]

Breathing                   14.2
HRV                           41
Signal                 Excellent

CURRENT ACTIVITY

Coding
Visual Studio Code • 38 min
```

Pulse should be visually dominant.

Signal quality should be understandable immediately.

---

# 38. TIMELINE DESIGN

The timeline should make correlations visually discoverable.

Possible design:

```text
9 AM ───────────────────────────────── 5 PM

ACTIVITY
████ Study
     ███ Class
         █████ Coding
               ██ Lunch
                  █████ Coding

PULSE
────╮───────╮────╯─────...

HRV
───────╮──╯────────────...
```

Clicking a period should provide:

```text
activity
duration
physiology
comparison to baseline
Iris explanation
```

---

# 39. PATTERNS DESIGN

Use large editorial insight cards rather than dozens of tiny metrics.

Each card should answer:

```text
WHAT DID IRIS NOTICE?

WHAT EVIDENCE SUPPORTS IT?

HOW CONFIDENT ARE WE?
```

---

# 40. ASK IRIS DESIGN

Voice should feel primary.

States:

```text
Idle
Listening
Transcribing
Analyzing
Retrieving evidence
Speaking
```

While Iris speaks, highlight relevant timeline evidence where practical.

---

# 41. DESIGN QUALITY

This project is also targeting Best Design.

Prioritize:

- restrained typography
- generous spacing
- high information hierarchy
- subtle animation
- realtime responsiveness
- minimal visual clutter
- excellent empty states
- excellent loading states
- excellent error states

Avoid:

- generic AI gradients everywhere
- excessive glassmorphism
- dozens of cards
- developer-looking dashboards
- overwhelming health-monitor UI
- fake precision

The product should resemble a polished consumer desktop application.

---

# 42. AI SAFETY / PRODUCT LANGUAGE

TrueIris is not a medical diagnostic product.

Avoid making unsupported statements such as:

```text
You are stressed.
You are anxious.
You have a heart problem.
You should seek medical treatment because of this sensor reading.
```

Prefer descriptive language:

```text
Your pulse is currently above your recent coding baseline.

Your HRV is lower than it has been during most recent
sessions of this type.

This period differs from your usual afternoon pattern.
```

Keep physiological interpretation evidence-grounded and modest.

---

# 43. AI ARCHITECTURE PRINCIPLE

TrueIris intelligence should be based on:

```text
sensor evidence
+
context
+
time-series analytics
+
semantic retrieval
+
personal baselines
+
Gemini reasoning
```

NOT:

```text
user question
→ giant prompt
→ unsupported LLM answer
```

Gemini is the reasoning and orchestration layer.

Tiger Data is the temporal memory.

Embeddings are semantic memory.

Presage is physiological perception.

ElevenLabs is conversational speech.

The operating system supplies digital context.

---

# 44. NO SCRAPING REQUIREMENT

Do not introduce traditional web scraping unless absolutely unavoidable.

Preferred data sources:

```text
Presage camera data
OS foreground application
OS idle state
user input
Gemini transient screen understanding
Tiger historical data
semantic embeddings
ElevenLabs voice
```

Use official APIs where future integrations require external services.

Do not scrape social networks, email websites, calendars, university sites, or arbitrary webpages for this MVP.

---

# 45. TESTING STRATEGY

For every major service create an interface and mock implementation.

Examples:

```ts
interface SensorProvider {}
interface VoiceProvider {}
interface ReasoningProvider {}
interface EmbeddingProvider {}
interface ContextProvider {}
```

Implement production and mock providers.

This allows TrueIris to run without every external API.

Test at least:

- sensor normalization
- epoch aggregation
- baseline calculations
- context segmentation
- Gemini tool schemas
- database serialization
- semantic retrieval
- demo seed generation
- API failure behavior

Use integration tests for core flows.

---

# 46. REQUIRED DEVELOPMENT COMMANDS

Standardize commands similar to:

```bash
pnpm install

pnpm dev
pnpm dev:desktop
pnpm dev:api

pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build

pnpm db:migrate
pnpm seed:demo
pnpm seed:clear
```

Update these instructions if repository tooling differs.

---

# 47. README REQUIREMENTS

Maintain a high-quality README.

It must include:

```text
What TrueIris is
Architecture
Sponsor technologies
System requirements
Environment setup
Presage setup
Tiger Data setup
Gemini setup
ElevenLabs setup
Vultr deployment
Development commands
Demo setup
Privacy behavior
Troubleshooting
```

Include an architecture diagram in Mermaid where useful.

Keep README synchronized with implementation.

---

# 48. HACKATHON DEMO TARGET

The final product must reliably support the following presentation.

## 0–15 seconds

Open TrueIris Live.

Camera is active.

Show genuine live physiological measurements.

Example:

```text
Pulse          73 BPM
Breathing      14.1/min
Signal         Excellent
Activity       Coding
```

---

## 15–30 seconds

Open Today.

Show several hours of seeded historical activity and physiological data.

Explain that TrueIris builds personal baselines.

---

## 30–60 seconds

Ask aloud:

```text
Iris, explain the last 30 minutes.
```

Pipeline should visibly execute:

```text
ElevenLabs transcription
→ Gemini
→ Tiger queries
→ baseline comparison
→ similar session retrieval
→ response
→ ElevenLabs speech
```

Timeline should highlight supporting evidence.

---

## 60–75 seconds

Show Patterns.

Display at least one personalized pattern.

---

## 75–90 seconds

Zoom out to week view or experiments.

Finish with the concept:

```text
TrueIris doesn't just measure you.

It learns how your state changes throughout your day
and lets you ask questions of your own patterns.
```

---

# 49. PRIORITY ORDER

Implement in this order unless existing repository state strongly justifies a change:

```text
P0
1. repository/application foundation
2. Presage live sensor
3. Live UI
4. Tiger persistence
5. Timeline
6. Context Engine
7. Personal baselines
8. Gemini tool-calling
9. "Explain last 30 minutes"
10. ElevenLabs voice

P1
11. Semantic memory
12. Patterns
13. Focus Mode
14. Event reconstruction
15. Demo data
16. Demo mode
17. Vultr deployment

P2
18. Experiments
19. Proactive insight engine
20. Optional screenshot context
21. additional polish
```

P0 must work before investing substantial time in P2.

---

# 50. FEATURE ACCEPTANCE CHECKLIST

Before calling any feature complete, verify:

```text
[ ] implementation exists
[ ] happy path works
[ ] failure path is reasonable
[ ] TypeScript passes
[ ] lint passes
[ ] tests pass
[ ] relevant production build passes
[ ] secrets are safe
[ ] UI state is handled
[ ] documentation updated if required
[ ] git diff inspected
[ ] feature committed
[ ] feature pushed
[ ] git status checked
```

Do not move to the next feature until these are satisfied, except when an external dependency makes a feature impossible and the limitation is explicitly documented.

---

# 51. AUTONOMY

Do not stop after every minor implementation decision to ask the user what to do.

Make reasonable senior-engineering decisions.

When multiple approaches are possible, prefer:

1. reliability
2. simplicity
3. strong typing
4. testability
5. demo stability
6. privacy
7. maintainability
8. performance where it matters

Do not overengineer infrastructure that does not contribute to the hackathon result.

If an implementation fails:

```text
inspect
→ diagnose
→ fix
→ retest
```

Do not immediately abandon the feature or replace it with fake functionality.

---

# 52. EXTERNAL DOCUMENTATION

When an SDK/API behavior is unclear, use current official documentation rather than relying on memory.

Prioritize official docs for:

```text
Presage SmartSpectra
Google Gemini
Tiger Data / TimescaleDB
ElevenLabs
Vultr
Electron
```

Avoid copying undocumented examples from random blogs when official documentation exists.

---

# 53. FINAL DEFINITION OF DONE

TrueIris is hackathon-ready when:

1. the webcam produces a genuine live Presage signal
2. readings are persisted to Tiger Data
3. activity context is attached to those readings
4. personalized baselines are calculated
5. the user can inspect a historical timeline
6. Gemini can retrieve information using explicit tools
7. Gemini can perform multi-step evidence-grounded comparisons
8. semantic session retrieval works
9. ElevenLabs supports voice input and spoken output
10. "Explain the last 30 minutes" works reliably
11. seeded historical data creates a convincing multi-day experience
12. the full 90-second demo works repeatedly
13. the backend can run on Vultr
14. secrets are not committed
15. documentation is complete
16. the repository builds successfully
17. every completed feature has its own commit
18. every completed feature commit has been pushed to the remote repository

Begin by inspecting the repository and current Git state.

Then establish the application foundation or adapt the existing foundation.

Work through the prioritized feature sequence.

Do not merely return a plan. Implement the project.