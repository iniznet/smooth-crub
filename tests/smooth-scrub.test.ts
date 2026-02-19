import { describe, expect, it } from 'vitest';
import { SmoothScrub } from '../src';
import fixtureRaw from '../fixtures/ascii-art.txt?raw';

interface AsciiFixture {
  name: string;
  ascii: string;
}

const normalizeSvg = (svg: SVGSVGElement): string =>
  svg.outerHTML.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

interface PathSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const parsePathSegments = (d: string): PathSegment[] => {
  const tokens = d.match(/[ML]|-?\d*\.?\d+/g) || [];
  const segments: PathSegment[] = [];
  let idx = 0;
  let cursor: { x: number; y: number } | null = null;

  while (idx < tokens.length) {
    const cmd = tokens[idx++];
    if (cmd === 'M') {
      const x = Number(tokens[idx++]);
      const y = Number(tokens[idx++]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cursor = { x, y };
    } else if (cmd === 'L') {
      const x = Number(tokens[idx++]);
      const y = Number(tokens[idx++]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !cursor) break;
      segments.push({ x1: cursor.x, y1: cursor.y, x2: x, y2: y });
      cursor = { x, y };
    }
  }

  return segments;
};

const trimOuterBlankLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;

  return lines.slice(start, end);
};

const parseFixtureSections = (raw: string): AsciiFixture[] => {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const sections: AsciiFixture[] = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];

  const commit = (): void => {
    if (!currentName) return;
    const asciiLines = trimOuterBlankLines(currentLines);
    if (!asciiLines.length) return;
    sections.push({
      name: currentName,
      ascii: asciiLines.join('\n'),
    });
  };

  for (const line of lines) {
    const header = line.match(/^===\s*(.+?)\s*===\s*$/);
    if (header) {
      commit();
      currentName = header[1];
      currentLines = [];
      continue;
    }
    if (currentName) {
      currentLines.push(line);
    }
  }

  commit();
  return sections;
};

const fixtureSections = parseFixtureSections(fixtureRaw);

describe('Fixture source parsing', () => {
  it('loads parseable sections from fixtures/ascii-art.txt', () => {
    expect(fixtureSections.length).toBeGreaterThan(0);
    for (const section of fixtureSections) {
      expect(section.name.length).toBeGreaterThan(0);
      expect(section.ascii.length).toBeGreaterThan(0);
    }
  });
});

describe('Fixture-driven rendering', () => {
  const scrubber = new SmoothScrub();

  it.each(fixtureSections)('renders "%s" into svg', ({ name, ascii }) => {
    expect(name.length).toBeGreaterThan(0);
    const formatted = scrubber.autoFormat(ascii);
    const svg = scrubber.render(formatted);
    const normalized = normalizeSvg(svg);

    expect(normalized.startsWith('<svg')).toBe(true);
    expect(svg.querySelector('path')).not.toBeNull();
    expect(normalized).toContain('<path');
    expect(normalized).toMatchSnapshot(name);
  });
});

describe('Centering micro-tests', () => {
  const scrubber = new SmoothScrub();

  it('centers bounded multi-word content with ^...^ syntax', () => {
    const ascii = [
      '┌──────────────────────────┐',
      '│ ^Multi word sentence^  │',
      '└──────────────────────────┘',
    ].join('\n');
    const svg = scrubber.render(scrubber.autoFormat(ascii));
    const node = Array.from(svg.querySelectorAll('text')).find(
      (textNode) => textNode.textContent === 'Multi word sentence'
    );

    expect(node).toBeTruthy();
    expect(node?.getAttribute('text-anchor')).toBe('middle');
  });

  it('keeps ^Text as unbounded centered syntax', () => {
    const ascii = ['┌──────────┐', '│ ^Text    │', '└──────────┘'].join('\n');
    const svg = scrubber.render(scrubber.autoFormat(ascii));
    const node = Array.from(svg.querySelectorAll('text')).find(
      (textNode) => textNode.textContent === 'Text'
    );

    expect(node).toBeTruthy();
    expect(node?.getAttribute('text-anchor')).toBe('middle');
  });
});

describe('ASCII arrowhead and connector alignment', () => {
  const scrubber = new SmoothScrub();

  it('connects horizontally through v arrowhead in ASCII mode', () => {
    const svg = scrubber.render('-v-');
    const path = svg.querySelector('path');
    const d = path?.getAttribute('d') ?? '';

    expect(path).toBeTruthy();
    expect(d.length).toBeGreaterThan(0);
  });

  it('connects vertically from | into v arrowhead in ASCII mode', () => {
    const svg = scrubber.render('|' + '\n' + 'v');
    const path = svg.querySelector('path');
    const d = path?.getAttribute('d') ?? '';

    expect(path).toBeTruthy();
    expect(d.length).toBeGreaterThan(0);
  });

  it('keeps standalone | as a structural connector', () => {
    const svg = scrubber.render('|' + '\n' + '|');
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    const verticalSegments = parsePathSegments(d).filter(
      (segment) =>
        Math.abs(segment.x1 - segment.x2) <= 0.01 && Math.abs(segment.y1 - segment.y2) > 0.01
    );

    expect(verticalSegments.length).toBeGreaterThan(0);
  });

  it('treats v in +--v--+ as structural connector in Plus ASCII fixture', () => {
    const ascii = [
      '+---------+',
      '| Service |',
      '+----+----+',
      '     |',
      '  +--v--+',
      '  | API |',
      '  +-----+',
    ].join('\n');
    const formatted = scrubber.autoFormat(ascii);
    const svg = scrubber.render(formatted);
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    const segments = parsePathSegments(d);

    const verticalSegments = segments
      .filter((segment) => Math.abs(segment.x1 - segment.x2) <= 0.01)
      .map((segment) => ({
        x: segment.x1,
        start: Math.min(segment.y1, segment.y2),
        end: Math.max(segment.y1, segment.y2),
      }));

    const horizontalSegments = segments
      .filter((segment) => Math.abs(segment.y1 - segment.y2) <= 0.01)
      .map((segment) => ({
        y: segment.y1,
        start: Math.min(segment.x1, segment.x2),
        end: Math.max(segment.x1, segment.x2),
      }));

    const rows = ascii.split('\n');
    const serviceRow = rows.findIndex((line) => line.includes('Service'));
    const connectorRow = rows.findIndex((line) => /^\s*\+[-=_]*v[-=_]*\+\s*$/.test(line));
    const serviceBottomRow = serviceRow + 1;
    const connectorCol = rows[connectorRow].indexOf('v');

    const toUniqueSorted = (values: number[]) =>
      Array.from(new Set(values.map((value) => Number(value.toFixed(3))))).sort((a, b) => a - b);

    const minPositiveDelta = (sorted: number[]): number | null => {
      let best = Infinity;
      for (let i = 1; i < sorted.length; i += 1) {
        const delta = sorted[i] - sorted[i - 1];
        if (delta > 0.01 && delta < best) best = delta;
      }
      return Number.isFinite(best) ? best : null;
    };

    const cw = minPositiveDelta(
      toUniqueSorted([
        ...horizontalSegments.flatMap((segment) => [segment.start, segment.end]),
        ...verticalSegments.map((segment) => segment.x),
      ])
    );
    const ch = minPositiveDelta(
      toUniqueSorted([
        ...horizontalSegments.map((segment) => segment.y),
        ...verticalSegments.flatMap((segment) => [segment.start, segment.end]),
      ])
    );

    expect(cw).toBeTruthy();
    expect(ch).toBeTruthy();

    const connectorX = (connectorCol + 1.5) * (cw as number);
    const serviceBottomY = (serviceBottomRow + 1.5) * (ch as number);
    const apiTopY = (connectorRow + 1.5) * (ch as number);

    const connector =
      verticalSegments.find(
        (segment) =>
          Math.abs(segment.x - connectorX) <= Math.max(1, (cw as number) * 0.2) &&
          segment.start <= serviceBottomY + 1 &&
          segment.end >= apiTopY - 1
      ) ?? null;

    const crossesApiTopBorder = horizontalSegments.some(
      (segment) =>
        Math.abs(segment.y - apiTopY) <= 1 &&
        segment.start <= connectorX + 0.5 &&
        segment.end >= connectorX - 0.5
    );

    expect(connector).toBeTruthy();
    expect(crossesApiTopBorder).toBe(true);
  });

  it('does not treat v inside words as connector with only + below', () => {
    const svg = scrubber.render('Service' + '\n' + '   +');
    const path = svg.querySelector('path');
    const d = path?.getAttribute('d') ?? '';

    expect(path).toBeTruthy();
    expect(d).toBe('');
  });

  it('preserves standalone connector stub indentation in autoFormat', () => {
    const ascii = ['+----+', '|Box |', '+-+--+', '  |', '  +--+'].join('\n');
    const formatted = scrubber.autoFormat(ascii);
    const formattedLines = formatted.split('\n');

    expect(formattedLines[3]).toBe('  |');
  });

  it('preserves right border alignment for indented API box content lines', () => {
    const ascii = [
      '+---------+',
      '| Service |',
      '+----+----+',
      '     |',
      '  +--v--+',
      '  | API |',
      '  +-----+',
    ].join('\n');
    const formatted = scrubber.autoFormat(ascii);
    const formattedLines = formatted.split('\n');

    expect(formattedLines[5]).toBe('  | API |');

    const svg = scrubber.render(formatted);
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    const segments = parsePathSegments(d);

    const verticalSegments = segments
      .filter((segment) => Math.abs(segment.x1 - segment.x2) <= 0.01)
      .map((segment) => ({
        x: segment.x1,
        start: Math.min(segment.y1, segment.y2),
        end: Math.max(segment.y1, segment.y2),
      }));

    const horizontalSegments = segments
      .filter((segment) => Math.abs(segment.y1 - segment.y2) <= 0.01)
      .map((segment) => ({
        y: segment.y1,
        start: Math.min(segment.x1, segment.x2),
        end: Math.max(segment.x1, segment.x2),
      }));

    const toUniqueSorted = (values: number[]) =>
      Array.from(new Set(values.map((value) => Number(value.toFixed(3))))).sort((a, b) => a - b);

    const minPositiveDelta = (sorted: number[]): number | null => {
      let best = Infinity;
      for (let i = 1; i < sorted.length; i += 1) {
        const delta = sorted[i] - sorted[i - 1];
        if (delta > 0.01 && delta < best) best = delta;
      }
      return Number.isFinite(best) ? best : null;
    };

    const cw = minPositiveDelta(
      toUniqueSorted([
        ...horizontalSegments.flatMap((segment) => [segment.start, segment.end]),
        ...verticalSegments.map((segment) => segment.x),
      ])
    );
    const ch = minPositiveDelta(
      toUniqueSorted([
        ...horizontalSegments.map((segment) => segment.y),
        ...verticalSegments.flatMap((segment) => [segment.start, segment.end]),
      ])
    );

    expect(cw).toBeTruthy();
    expect(ch).toBeTruthy();

    const apiContentRow = 5;
    const apiTopRow = 4;
    const apiBottomRow = 6;
    const rightWallCol = formattedLines[apiContentRow].lastIndexOf('|');

    expect(rightWallCol).toBeGreaterThan(0);

    const rightWallX = (rightWallCol + 1.5) * (cw as number);
    const apiTopY = (apiTopRow + 1.5) * (ch as number);
    const apiBottomY = (apiBottomRow + 1.5) * (ch as number);

    const rightBorder =
      verticalSegments.find(
        (segment) =>
          Math.abs(segment.x - rightWallX) <= Math.max(1, (cw as number) * 0.2) &&
          segment.start <= apiTopY + 1 &&
          segment.end >= apiBottomY - 1
      ) ?? null;

    expect(rightBorder).toBeTruthy();
  });
});

describe('Regression Tests (Bug Fixes)', () => {
  const scrubber = new SmoothScrub();

  it('Issue 2: autoFormat skips structural-only lines', () => {
    const input = ['+--v--+', '| Longer Text Here |', '+-----+'].join('\n');
    const formatted = scrubber.autoFormat(input);
    const lines = formatted.split('\n').filter((line) => line.trim().length > 0);

    expect(lines[0]).toBe('+--v--+');
    expect(lines[2]).toBe('+-----+');
  });

  it('Issue 4: autoFormat preserves indented Bottom box wall with ^ content', () => {
    const input = [
      '+--------------------+----------------+',
      '| very long anchor row to force width |',
      '+--------------------------------------+',
      '        +----v-----+',
      '        | ^Bottom  |',
      '        +----------+',
    ].join('\n');

    const formatted = scrubber.autoFormat(input);
    const lines = formatted.split('\n');

    expect(lines[4]).toBe('        | ^Bottom  |');
  });
});
