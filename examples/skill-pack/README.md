# Thinkwork Skill Pack — Example

This directory contains two example skills that demonstrate the Thinkwork skill contract.
Use them as a reference when building your own skills.

## Structure

```
skill-pack/
  calculator/
    skill.yaml   # Skill metadata and configuration
    SKILL.md     # Instructions + tool definitions for the agent runtime
  github-issues/
    skill.yaml
    SKILL.md
  test.mjs       # Validation script
  package.json
```

Each skill lives in its own subdirectory and requires exactly two files:

### skill.yaml

Declares the skill's metadata, execution mode, required environment variables, and
optional OAuth configuration. Required fields:

| Field          | Description                                               |
| -------------- | --------------------------------------------------------- |
| `slug`         | Unique identifier, kebab-case (e.g. `github-issues`)     |
| `display_name` | Human-readable name shown in the UI                      |
| `description`  | One-line description of what the skill does              |
| `category`     | One of `utilities`, `integrations`, `research`, `custom` |
| `version`      | Semver string                                            |
| `execution`    | `context` (inline) or `script` (subprocess)              |

### SKILL.md

Loaded into the agent's context when the skill is active. Uses YAML frontmatter
(name, description, license, metadata) followed by markdown sections.

Sections:
- **Tools** — Bullet list of available tool names with short descriptions.
- **Usage** — Behavioral guidelines for the agent.
- **Context** — Optional environment or auth notes.

Keep SKILL.md concise — it's injected into the system prompt on every request.

## Adding a New Skill

1. Create a subdirectory: `my-skill/`
2. Add `skill.yaml` with at minimum: `slug`, `display_name`, `description`, `category`, `version`
3. Add `SKILL.md` with YAML frontmatter and a `## Tools` section
4. Run `node test.mjs` to validate

## Testing

```bash
node test.mjs
```

The validator checks that every skill directory has both required files, that
`skill.yaml` contains all required fields, and that `SKILL.md` has valid
frontmatter with `name` and `description`.

## Deploying a Skill

Skills are deployed by uploading the skill directory to S3 under
`skills/catalog/<slug>/`. The AgentCore Lambda syncs skills from S3 on startup
and injects matching SKILL.md files into the agent context based on the
workspace configuration.

See the [Thinkwork documentation](https://docs.thinkwork.ai/skills) for full
deployment instructions.
