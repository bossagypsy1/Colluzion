# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository.

> **Status:** skeleton. Sections marked _TBD_ will be filled in from the full project brief.

## Project overview

**Colluzion** is a node-based audiovisual editor in the spirit of TouchDesigner.
It takes an audio track as input, analyzes its sound signals (amplitude, frequency
bands, onsets/beats, etc.), and uses those signals to drive and process video.

Core idea: **audio in → signal analysis → signals mapped to video parameters → video out.**

## Goals

- _TBD_

## Non-goals

- _TBD_

## Tech stack

- Language(s): _TBD_
- Audio analysis: _TBD_
- Video / rendering: _TBD_
- UI: _TBD_
- Build / package manager: _TBD_

## Architecture

_TBD_ — expected major parts:

- **Audio input & decoding** — load the track, expose playback/time.
- **Signal analysis** — turn audio into control signals.
- **Node graph** — operators connected by signal and video edges.
- **Video pipeline** — sources, effects, compositing driven by signals.
- **Timeline / transport** — keeps audio and video in sync.
- **Export** — render the final audiovisual output.

## Repository layout

_TBD_ (will be documented as the codebase is created)

## Development

```sh
# setup:  TBD
# run:    TBD
# test:   TBD
# lint:   TBD
```

## Conventions

- Keep audio and video timing in sync from a single clock source.
- Prefer small, composable operators over large monolithic ones.
- Real-time performance matters: avoid allocations and blocking work on audio/render threads.
- Coding style, naming, and commit conventions: _TBD_

## Agent workflow

- Read this file before making changes; keep it updated when architecture or commands change.
- Run tests and linters before committing once they exist.
- Don't add large binary media to the repo; use small fixtures for tests.
