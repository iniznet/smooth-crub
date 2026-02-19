# smooth-scrub

Smooth Scrub turns ASCII/Unicode diagram text into clean, scalable SVG output.
It is useful when you want to keep diagrams editable as plain text but render them sharply in web UIs, docs, or tooling.

## Project Status

This project is currently an **early beta** and active playground.

- APIs and output details may change between beta releases.
- Expect rough edges while ideas are being explored.
- The current goal is experimentation, learning, and fun.

If you use this in production, pin versions and test carefully before upgrading.

## Features

- Centered text with bounded syntax: `^Text^`
- Centered text with unbounded syntax: `^Text`
- Left-aligned text: `<Text`
- Right-aligned text: `>Text` or `Text>`
- Wide character support (emoji and CJK-aware display width)
- Border alignment and automatic spacing with `autoFormat()`
- Multiple UI pattern support (ASCII and box-drawing rich mode)
- Arrowheads and connectors: `v` (down), `+` (junction)

## Installation

**Requirements:** Node.js ≥18

```bash
npm install smooth-scrub
```

### Module Support

The library provides **ESM**, **CommonJS**, and **TypeScript** type definitions automatically. All modules are exported from the main package:

```ts
// ESM
import { SmoothScrub } from 'smooth-scrub';

// CommonJS
const { SmoothScrub } = require('smooth-scrub');
```

## Quick Start

```ts
import { SmoothScrub } from 'smooth-scrub';

const scrubber = new SmoothScrub();

const ascii = `
┌──────────────────────────┐
│^Welcome to Smooth Scrub^│
│^Emoji 😀 + CJK 漢字      │
└──────────────────────────┘
`.trim();

const normalized = scrubber.autoFormat(ascii);
const svg = scrubber.render(normalized);
document.body.appendChild(svg);
```

## Alignment Syntax

Smooth Scrub supports multiple text alignment markers:

- **Center**: `^Text^` (bounded) or `^Text` (leading)
- **Left**: `<Text` (leading)
- **Right**: `>Text` (leading) or `Text>` (trailing)

### How it behaves

- `^...^` centers the enclosed content and strips both markers.
- `^...`, `<...`, `>...` aligns from the marker and strips the marker.
- `...>` aligns to the right and strips the trailing marker.
- `^^` is treated as literal text (escapes the centering command).
- If no alignment marker exists, text follows normal zone alignment behavior.
- Use `autoFormat()` to automatically balance centered text (`^`) within structural boxes.

## Structural Elements

Smooth Scrub identifies several characters as structural elements that form paths:

- **Rich Mode**: Uses Unicode box-drawing characters like `┌`, `─`, `┼`, `║`, etc. Detected automatically when these characters are present.
- **ASCII Mode**: Uses `+`, `-`, `|`, `=`, `_`, `/`, `\` for boxes and connectors.
- **Arrows**: `v` is treated as a down-pointing arrowhead in ASCII mode. `^` is reserved for text centering and is not a vertical connector.

### Auto-detection

The library automatically detects which mode to use based on the presence of Unicode box-drawing characters. If your ASCII contains any box-drawing chars, Rich Mode is enabled. Otherwise, ASCII Mode is used.

### Visual Examples

**Rich Mode** (Unicode):
```
┌─────────────────┐
│ ^Centered Text^ │
│ <Left    Right> │
└─────────────────┘
```

**ASCII Mode**:
```
+-------------------+
| ^Centered Text^   |
| <Left    Right>   |
+-------------------+
```

Both modes render to identical SVG output when `autoFormat()` is used.

## Demo

Run a local demo server:

```bash
npm run demo
```

Then open your browser to the URL printed in terminal output.

Use this fixture to test/preview behavior:

- `fixtures/ascii-art.txt`

## API Reference

### `new SmoothScrub(options?)`

Creates a renderer instance.

**Options:**

- `scale?: number` - Global scale factor for the SVG.
- `cellWidth?: number` - Horizontal grid unit size (default: `12`).
- `cellHeight?: number` - Vertical grid unit size (default: `24`).
- `color?: string` - Stroke color for structural elements (default: `#333`).
- `strokeWidth?: number` - Thickness of structural lines (default: `2.5`).
- `background?: string` - Optional background color.
- `fontFamily?: string` - Font family for text rendering.

### `render(ascii: string): SVGSVGElement`

Renders an ASCII/Unicode diagram into an SVG element.

> Note: `render()` requires a DOM environment (browser or JSDOM).

### `autoFormat(ascii: string): string`

Normalizes spacing/alignment to reduce jagged borders and width mismatch issues.

**When to use:**
- Before `render()` if your ASCII diagram has ragged borders or inconsistent column widths.
- Essential when using centered text (`^`) within boxes to ensure symmetrical padding.
- Optional for simple unboxed text, but recommended for professional output.

**What it does:**
- Detects structural boundaries (box walls, borders).
- Balances centered content (`^Text^`) with padding on both sides.
- Aligns structural-only lines without distorting them.
- Preserves indentation and nesting.

**Example:**
```ts
const rough = `
┌────────────────┐
│^Title^         |
│some text       │
└────────────────┘
`;

const formatted = scrubber.autoFormat(rough);
const svg = scrubber.render(formatted);
```

## Browser Requirements

The `render()` method requires a DOM environment. It works in:

- ✅ Modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ Node.js with JSDOM (for testing, e.g., Vitest)

Use `autoFormat()` freely in Node.js; it returns a string.

## Development

```bash
npm run build
npm run test
npm run demo
```

### Main Commands

- `npm run build` - Bundle the library into `dist/`.
- `npm run test` - Run the test suite with Vitest.
- `npm run demo` - Launch the local development server to preview diagrams.
- `npm run format` - Format code with Prettier.

### Snapshot Testing

Snapshot tests capture expected SVG output for known inputs.

If you intentionally change rendering behavior, update snapshots with:

```bash
npm run test:update
```

Equivalent direct command:

```bash
vitest run -u
```

## Contributing

Contributions are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening issues or pull requests.

## License

MIT
