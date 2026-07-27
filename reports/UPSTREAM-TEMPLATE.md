# Upstream Report Template

Use this template when you discover a bug, documentation gap, broken example, or unexpected behavior in KeeperHub.

## Report format

```markdown
## Summary
One-line description of the issue.

## Environment
- KeeperHub version/date:
- API endpoint used:
- MCP transport (HTTP/SSE):
- Workflow type (scheduled/webhook/block-event):

## What happened
A clear description of the behavior you observed.

## What you expected
A clear description of what should have happened.

## Steps to reproduce
1. 
2. 
3. 

## Minimal reproducer
```json
// Workflow config or API payload that triggers the issue
```

## Impact
- [ ] Blocks feature development
- [ ] Causes incorrect behavior
- [ ] Documentation gap
- [ ] Minor inconvenience

## Workaround in LegacyKeeper
How we handled it to keep the build moving.

## Suggested fix (optional)
What you think the correct behavior should be.
```

## Known issues (LegacyKeeper internal)

Date | Component | Issue | Workaround | Reported upstream?
-----|-----------|-------|------------|-------------------
