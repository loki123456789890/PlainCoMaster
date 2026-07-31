# CLAUDE.md

## Design Context

This project has `PRODUCT.md` and `DESIGN.md` at the repo root — read them before doing UI/design work.

- **Register:** product (task-focused app UI, not marketing)
- **Platform:** adaptive (React Native / Expo, ships iOS + Android from one codebase, own custom brand system rather than HIG/Material)
- **North star:** "The Neighborhood Thrift Counter" — warm, plainspoken, flat-by-default; Clay is the only primary-action color, Moss doubles as the success color, Gold is reserved for money.
- Component vocabulary lives in `components/ui/` (Button, Card, Badge, Input, EmptyState) and tokens in `constants/theme.ts`. Reuse these rather than hand-rolling new styles.
