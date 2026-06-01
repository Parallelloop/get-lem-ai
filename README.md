# get-lem-ai 🚀

> **Lem Ai ([getlem.ai](https://getlem.ai)) Git Hook for Automated Context & Implementation Synthesis**  
> Automatically generate `Implementation.md` documentation from Jira tickets upon creating new local Git branches.

`get-lem-ai` is a lightweight, stack-agnostic Git hook CLI tool designed to link your local development environment directly to the **Lem Ai ([getlem.ai](https://getlem.ai))** knowledge graph. By capturing branch creation transactions, it dynamically fetches issue details, outlines architectural expectations, and generates detailed implementation specifications without delaying your Git checkout flow.

---

## Key Features ⚡

* **Instantaneous Git Checkout:** Spawns a detached background node process so your terminal checkouts proceed instantly without waiting for API responses.
* **Smart Jira-Key Resolution:** Employs robust pattern-matching regex to extract Jira IDs directly from branch naming conventions (e.g. `feature/PROJ-123-auth`).
* **Automated Evidence Collection:** Communicates with the Lem Ai ([getlem.ai](https://getlem.ai)) platform to automatically generate `Implementation.md` files in the root of your project.
* **SOC 2 & SOP Compliance Guardrail:** Standardizes developmental structure by aligning your branch intent with administrative Jira tickets.
* **Easy Hook Management:** Single commands to install, configure, or cleanly uninstall hook integrations.

---

## Prerequisites 📋

* **Node.js** (v14.0.0 or higher)
* **Git** installed and initialized in your workspace (`git init`)
* **Lem SDK API Key** (obtainable from your Lem workspace developer settings page)

---

## Quick Start Setup Guide 🔧

Follow these three simple steps to integrate `get-lem-ai` into your local development repository:

### Step 1: Install the Package Globally
Install the package globally via `npm` to expose the global `get-lem-ai` executable commands:
```bash
npm install -g get-lem-ai
```

### Step 2: Configure Your API Profile
Initialize your configuration by running the wizard. You will be prompted to enter your preferred documentation filename and your secure API key:
```bash
get-lem-ai setup
```
* **Output filename [Implementation.md]:** Press enter to accept the default or specify a custom documentation path.
* **SDK API Key:** Paste your secure Lem developer token.

This creates a global configuration saved inside your environment as a local `.lem-ai.json` profile.

### Step 3: Install Hook in Your Git Repository
Navigate to the root directory of your active local Git project and initialize the hook:
```bash
cd /path/to/your/git/repository
get-lem-ai install
```
*This command injects a reference-transaction shell script into `.git/hooks/reference-transaction` designed to capture branch shifts.*

---

## How It Works Under the Hood 🛠️

```
┌─────────────────┐       ┌───────────────────────────┐       ┌─────────────────┐
│  git checkout   │ ────> │  reference-transaction    │ ────> │   get-lem-ai    │
│  -b PROJ-123    │       │  hook intercepts event    │       │   background    │
└─────────────────┘       └───────────────────────────┘       └────────┬────────┘
                                                                       │
                                                                       ▼
┌─────────────────┐       ┌───────────────────────────┐       ┌─────────────────┐
│ Write completed │ <──── │   Lem platform returns    │ <──── │   Request API   │
│ Document file   │       │   context & architecture  │       │  with Jira key  │
└─────────────────┘       └───────────────────────────┘       └─────────────────┘
```

1. **Transaction Capture:** The reference-transaction hook triggers whenever local branches are created (using `git branch`, `git checkout -b`, or `git switch -c`).
2. **Jira Key Extraction:** The tool parses the branch string searching for active Jira keys (e.g. `SOP-42`, `PROJ-999`).
3. **Decoupled Request:** A detached background worker is spawned with `LEMAI_BG=true` redirecting outputs to `.lem-ai.log`. The parent process exits immediately to prevent terminal blocking.
4. **Document Generation:** The worker sends the context payload to the Lem Ai ([getlem.ai](https://getlem.ai)) engine which analyzes the corresponding ticket parameters, synthesizes architectural directions, and compiles a comprehensive `Implementation.md` locally.

---

## Commands Reference 📖

### `get-lem-ai setup`
Launches the setup prompt wizard to configure your output target file and credentials.

### `get-lem-ai install`
Safely registers the `reference-transaction` hook inside the current repository's `.git/hooks` folder. If a hook already exists, it intelligently appends or keeps legacy hooks safe.

### `get-lem-ai uninstall`
Cleans up the workspace by deleting the active git hook and removing the project-level `.lem-ai.json` config profile.

### `get-lem-ai checkout <branchName>`
The internal entrypoint callback fired by the Git transaction hook. Can also be called manually to dry-run or force generation:
```bash
get-lem-ai checkout feature/PROJ-123-api-limits
```

---

## Troubleshooting & Files 🔍

* **`.lem-ai.json`**: Located in the root of your project or home directory. Contains your secure authorization keys and output targets. **Keep this ignored from public git repositories!**
* **`.lem-ai.log`**: Standard output log compiled during background runs. If your `Implementation.md` file did not generate, inspect this file to diagnose connection or API authorization issues.

---

## License 📄

This project is licensed under the **MIT License**.
