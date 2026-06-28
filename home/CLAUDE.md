# Global instructions
@claude-kit-doctrine.md

# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

**Using an existing graph.** When a codebase has a `graphify-out/` directory, treat `/graphify query` as the first orientation pass for architecture and relationship questions (how does X work, what calls Y, trace the data flow through Z) before reading files broadly. The graph is a map, not the territory: confirm any claim you'll act on against the real file it cites, and treat it as possibly stale if commits landed after the last build. Querying an existing graph is the free win; building a new one is the user's call, not an unprompted step.
