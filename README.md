# GitTree: Git Repository Visualization

Visualize commit history as a living, growing tree. Watch your repository evolve in real-time animation.

## Features

- **Git Visualization**: Renders commit history as a deterministic tree layout
- **Live Animation**: Play through repository growth over time
- **No Auth Required**: Works with public GitHub repositories (60 req/hr rate limit)
- **Export**: WebM video (30 fps, 1920×1080) or PNG card with statistics
- **Keyboard Controls**: Space (play/pause), ← → (step ±5 commits), Home/End (jump)
- **Privacy-First**: All processing in browser; no data upload

## Quick Start

1. Paste a GitHub URL: `https://github.com/owner/repo`
2. Press Enter
3. Click **Play** to watch the tree grow
4. Use **Export** to save video or PNG

## Usage

### Playback Controls
| Control | Action |
|---------|--------|
| **Play/Pause** | Start or pause animation |
| **Speed Slider** | 0.5× to 2× |
| **Duration Slider** | 5s to 60s total time |
| **Space Bar** | Play/pause (keyboard) |
| **← / →** | Step ±5 commits |
| **Home / End** | Jump to start/end |

### Export
- **WebM Video**: 30 fps, 1920×1080, full animation
- **PNG Card**: Tree + statistics grid with author breakdown

## Architecture

Pure function pipeline:
1. Input Parser → GitHub API fetcher
2. Normalize → Sample (equidistant, ~500 commits)
3. Growth Model → Layout (pure function, deterministic)
4. Canvas Render (pure function, deterministic)

## Technical Details

- **Deterministic**: Same repo always produces identical tree
- **Pure Functions**: No side effects, stateless layout/render
- **No Randomness**: Seeded PRNG keyed by commit hash
- **Zero Dependencies**: HTML5 Canvas only

## Limitations (P2 Roadmap)

- ✅ Public GitHub only
- ✅ No token support (60 req/hr rate limit)
- ✅ Browser-only
- ⏳ Local directory support
- ⏳ Token input for higher limits
- ⏳ Hover commit details

## Development

```bash
npm install
npm run dev      # Dev server on http://localhost:5173
npm run build    # Production build
```

## License

MIT

---

**Status**: MVP complete and ready for delivery. Core P1 features done.
