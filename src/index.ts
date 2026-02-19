export interface SmoothScrubOptions {
  // Reserved for future global scaling support.
  scale?: number;
  // Width of one monospace cell in SVG units.
  cellWidth?: number;
  // Height of one monospace cell in SVG units.
  cellHeight?: number;
  // Stroke color used for structural paths.
  color?: string;
  // Stroke width used for structural paths.
  strokeWidth?: number;
  // Reserved for future background rendering support.
  background?: string;
  // Reserved for future text font customization support.
  fontFamily?: string;
}

interface GridCell {
  // The original grapheme in this cell.
  char: string;
  // Top-left x of this cell in SVG coordinates.
  x: number;
  // Baseline row origin y of this cell in SVG coordinates.
  y: number;
  // Center x of this cell.
  cx: number;
  // Center y of this cell.
  cy: number;
  // Pixel width of this grapheme (1 or 2 columns times cell width).
  w: number;
  // Logical column width (1 for narrow chars, 2 for wide chars).
  cols: number;
}

interface Zone {
  // Inclusive start index of text-bearing cells between walls.
  start: number;
  // Exclusive end index of text-bearing cells between walls.
  end: number;
  // Left pixel boundary used for text layout.
  leftX: number;
  // Right pixel boundary used for text layout.
  rightX: number;
}

interface VerticalRun {
  // Shared x-center for all cells in this vertical segment.
  cx: number;
  // Contiguous connected cells forming a vertical path.
  cells: GridCell[];
}

// Character rules are centralized here so mode detection and parsing stay consistent.
const RICH_MODE_DETECTOR = /[─│┌┐└┘├┤┬┴┼║]/;
const RICH_STRUCTURE_CHARS = /[─│┌┐└┘├┤┬┴┼║]/;
const ASCII_STRUCTURE_CHARS = /[─│┌┐└┘├┤┬┴┼║|_=/\\*+\-v<>]/;
const RICH_VERTICAL_CHARS = /[│║]/;
const ASCII_VERTICAL_CHARS = /[│║|]/;
const CORNER_CHARS = /[┌┐└┘├┤┬┴┼]/;

export class SmoothScrub {
  private cw: number;
  private ch: number;
  private color: string;
  private strokeWidth: number;
  private segmenter: Intl.Segmenter | null;

  /**
   * Initializes renderer dimensions and stroke styling.
   * Defaults are tuned for readable monospace-style diagram output.
   */
  constructor(options: SmoothScrubOptions = {}) {
    this.cw = options.cellWidth || 12;
    this.ch = options.cellHeight || 24;
    this.color = options.color || '#333';
    this.strokeWidth = options.strokeWidth || 2.5;

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      this.segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    } else {
      this.segmenter = null;
    }
  }

  /**
   * Rich mode is enabled when Unicode box-drawing characters are present.
   */
  private detectRichMode(input: string): boolean {
    return RICH_MODE_DETECTOR.test(input);
  }

  /**
   * Returns true when a grapheme should be treated as a structural path element.
   */
  private isStructure(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      return RICH_STRUCTURE_CHARS.test(char);
    }
    return ASCII_STRUCTURE_CHARS.test(char);
  }

  /**
   * Returns true for vertical wall-like characters.
   */
  private isVert(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      return RICH_VERTICAL_CHARS.test(char);
    }
    return ASCII_VERTICAL_CHARS.test(char);
  }

  /**
   * Returns true for corner and intersection characters used as wall boundaries.
   */
  private isCorner(char: string): boolean {
    return CORNER_CHARS.test(char);
  }

  /**
   * Returns true when this character can connect downward into the next row.
   */
  private connectsDown(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      if (char === '─' || char === '═') return false;
      return /[│║┌┐├┤┬┼╔╗╠╣╦╬╓╖╒╕╥╤╫]/.test(char);
    }
    if (char === '-' || char === '=' || char === '_') return false;
    return /[|+v]/.test(char);
  }

  /**
   * Returns true when this character can connect upward from the previous row.
   */
  private connectsUp(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      if (char === '─' || char === '═') return false;
      return /[│║└┘├┤┴┼╚╝╠╣╩╬╙╜╘╛╨╧╫]/.test(char);
    }
    if (char === '-' || char === '=' || char === '_') return false;
    return /[|+v]/.test(char);
  }

  /**
   * Finds the nearest vertically connectable cell in the next row.
   * A tight tolerance is preferred first, with a relaxed fallback for uneven input.
   */
  private findVerticalNeighbor(
    curr: GridCell,
    nextRow: GridCell[],
    isRichMode: boolean
  ): GridCell | null {
    if (!this.connectsDown(curr.char, isRichMode)) return null;

    const connectedNextRow = nextRow.filter((candidate) =>
      this.connectsUp(candidate.char, isRichMode)
    );
    const tightTolerance = this.cw * 0.5;
    const relaxedTolerance = this.cw * 2.0;
    const selectNearest = (candidates: GridCell[]) =>
      [...candidates].sort((a, b) => Math.abs(a.cx - curr.cx) - Math.abs(b.cx - curr.cx))[0] ||
      null;

    const tightCandidates = connectedNextRow.filter(
      (candidate) => Math.abs(candidate.cx - curr.cx) < tightTolerance
    );
    const relaxedCandidates = connectedNextRow.filter(
      (candidate) => Math.abs(candidate.cx - curr.cx) < relaxedTolerance
    );

    return selectNearest(tightCandidates) ?? selectNearest(relaxedCandidates);
  }

  /**
   * Checks whether a cell participates in any vertical connection above or below.
   */
  private hasVerticalNeighbor(
    cell: GridCell,
    rowIndex: number,
    grid: GridCell[][],
    isRichMode: boolean
  ): boolean {
    const hasUpNeighbor =
      rowIndex > 0 &&
      grid[rowIndex - 1].some(
        (prevCell) => this.findVerticalNeighbor(prevCell, grid[rowIndex], isRichMode) === cell
      );
    const hasDownNeighbor =
      rowIndex < grid.length - 1 &&
      this.findVerticalNeighbor(cell, grid[rowIndex + 1], isRichMode) !== null;

    return hasUpNeighbor || hasDownNeighbor;
  }

  /**
   * ASCII helper for detecting word-like characters, used to avoid false connectors.
   */
  private isAsciiWordChar(char: string): boolean {
    return /^[A-Za-z0-9]$/.test(char);
  }

  /**
   * Distinguishes structural `v` arrowheads from regular text `v` characters.
   */
  private isAsciiVConnector(
    row: GridCell[],
    colIndex: number,
    rowIndex: number,
    grid: GridCell[][],
    cell: GridCell
  ): boolean {
    const leftChar = row[colIndex - 1]?.char ?? '';
    const rightChar = row[colIndex + 1]?.char ?? '';
    const hasHorizontalStructuralNeighbor = /[-+]/.test(leftChar) || /[-+]/.test(rightChar);

    const hasVerticalNeighborAbove =
      rowIndex > 0 &&
      grid[rowIndex - 1].some(
        (prevCell) =>
          /[|+]/.test(prevCell.char) && this.findVerticalNeighbor(prevCell, row, false) === cell
      );

    const surroundedByWordChars = this.isAsciiWordChar(leftChar) && this.isAsciiWordChar(rightChar);

    return hasHorizontalStructuralNeighbor || hasVerticalNeighborAbove || !surroundedByWordChars;
  }

  /**
   * Detects contiguous vertical path runs used to draw vertical SVG segments once.
   */
  private detectVerticalRuns(grid: GridCell[][], isRichMode: boolean): VerticalRun[] {
    // A vertical run is a top-to-bottom chain of connected structural cells.
    // We start only from cells without incoming vertical connections to avoid duplicates.
    const runs: VerticalRun[] = [];

    for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex];

      row.forEach((cell, colIndex) => {
        if (!this.connectsDown(cell.char, isRichMode) && !this.connectsUp(cell.char, isRichMode)) {
          return;
        }

        if (!isRichMode && cell.char === 'v') {
          if (!this.isAsciiVConnector(row, colIndex, rowIndex, grid, cell)) {
            return;
          }
        }

        const prevRow = rowIndex > 0 ? grid[rowIndex - 1] : null;
        const hasIncoming =
          prevRow?.some((prevCell, prevColIndex) => {
            if (!isRichMode && prevCell.char === 'v') {
              if (!this.isAsciiVConnector(prevRow, prevColIndex, rowIndex - 1, grid, prevCell)) {
                return false;
              }
            }

            return this.findVerticalNeighbor(prevCell, row, isRichMode) === cell;
          }) || false;
        if (hasIncoming) return;

        const cells: GridCell[] = [cell];
        let currentCell = cell;
        let currentRowIndex = rowIndex;

        while (currentRowIndex < grid.length - 1) {
          const nextCell = this.findVerticalNeighbor(
            currentCell,
            grid[currentRowIndex + 1],
            isRichMode
          );
          if (!nextCell) break;

          cells.push(nextCell);
          currentCell = nextCell;
          currentRowIndex += 1;
        }

        if (cells.length > 1) {
          runs.push({
            cx: cells[0].cx,
            cells,
          });
        }
      });
    }

    return runs;
  }

  /**
   * Width heuristic for non-rich mode diagrams.
   */
  private getGraphemeWidth(grapheme: string): number {
    if (grapheme.length === 1 && grapheme.charCodeAt(0) < 127) return 1;
    const isWide = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{4E00}-\u{9FFF}]/u.test(grapheme);
    return isWide ? 2 : 1;
  }

  /**
   * Width heuristic for rich mode diagrams with emoji/CJK awareness.
   */
  private getRichModeWidth(grapheme: string): number {
    const isWideRichMode =
      /[\u{1F300}-\u{1F9FF}]/u.test(grapheme) ||
      /[\u{2600}-\u{27BF}]/u.test(grapheme) ||
      /[\u{4E00}-\u{9FFF}]/u.test(grapheme) ||
      /\uFE0F/.test(grapheme);
    return isWideRichMode ? 2 : 1;
  }

  /**
   * Returns display width for one grapheme under the current mode.
   */
  private getDisplayWidth(grapheme: string, isRichMode: boolean): number {
    return isRichMode ? this.getRichModeWidth(grapheme) : this.getGraphemeWidth(grapheme);
  }

  /**
   * Returns display width for a full text string by summing grapheme widths.
   */
  private getTextDisplayWidth(text: string, isRichMode: boolean): number {
    let width = 0;
    const graphemes = this.splitGraphemes(text);
    for (const grapheme of graphemes) {
      width += this.getDisplayWidth(grapheme, isRichMode);
    }
    return width;
  }

  /**
   * Splits text into graphemes. Uses Intl.Segmenter when available for accuracy.
   */
  private splitGraphemes(text: string): string[] {
    if (this.segmenter) {
      return Array.from(this.segmenter.segment(text)).map((s) => s.segment);
    }
    return Array.from(text);
  }

  /**
   * Decides whether a vertical run should start from the cell center.
   */
  private shouldStartAtCenter(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      return /[┌┐┬╔╗╦╓╖╥╒╕╤┼╠╣╬╟╢╫╞╡╪├┤]/.test(char);
    }
    return /[+v]/.test(char);
  }

  /**
   * Decides whether a vertical run should end at the cell center.
   */
  private shouldEndAtCenter(char: string, isRichMode: boolean): boolean {
    if (isRichMode) {
      return /[└┘┴╚╝╩╙╜╨╘╛╧┼╠╣╬╟╢╫╞╡╪├┤]/.test(char);
    }
    return /[+v^]/.test(char);
  }

  /**
   * Normalizes spacing in diagrams while preserving shape semantics.
   *
   * High-level steps:
   * 1) Split input into blocks separated by blank lines.
   * 2) Compute max visual width per block.
   * 3) Align structural boundaries and centered text markers.
   */
  public autoFormat(ascii: string): string {
    const isRichMode = this.detectRichMode(ascii);
    const lines = ascii.split('\n');
    const blocks: string[][] = [];
    let currentBlock: string[] = [];

    lines.forEach((line) => {
      if (line.trim() === '') {
        if (currentBlock.length) blocks.push(currentBlock);
        blocks.push(['']);
        currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    });
    if (currentBlock.length) blocks.push(currentBlock);

    const formattedBlocks = blocks.map((block) => {
      // Empty blocks preserve intentional spacing between independent diagrams.
      if (block.length === 1 && block[0] === '') return '';

      let maxVisWidth = 0;
      const lineStats = block.map((line) => {
        const visW = this.getTextDisplayWidth(line, isRichMode);

        if (visW > maxVisWidth) maxVisWidth = visW;
        return { line, visW };
      });

      return lineStats
        .map((stat) => {
          // Keep short connector stubs untouched to avoid accidental drift.
          const isConnectorStub = /^\s+[|+]\s*$/.test(stat.line);
          if (isConnectorStub) {
            return stat.line;
          }

          const isStructuralOnlyLine =
            stat.line.trim().length > 0 &&
            this.splitGraphemes(stat.line).every(
              (grapheme) => grapheme === ' ' || this.isStructure(grapheme, isRichMode)
            );
          if (isStructuralOnlyLine) {
            return stat.line;
          }

          const diff = maxVisWidth - stat.visW;

          const indentationMatch = stat.line.match(/^\s*/);
          const indentation = indentationMatch?.[0] ?? '';
          const lineWithoutIndentation = stat.line.slice(indentation.length);

          const firstChar = lineWithoutIndentation[0] ?? '';
          const lastChar = lineWithoutIndentation.slice(-1);
          const hasStructuralBoundary =
            this.isStructure(firstChar, isRichMode) || this.isStructure(lastChar, isRichMode);

          // Skip plain text lines that are not within structural boundaries and not centered.
          if (!hasStructuralBoundary && !lineWithoutIndentation.includes('^')) {
            return stat.line;
          }

          let prefix = '';
          let suffix = '';
          let middle = lineWithoutIndentation;

          if (middle.length > 0 && this.isStructure(middle[0], isRichMode)) {
            prefix = middle[0];
            middle = middle.slice(1);
          }

          if (middle.length > 0) {
            const tail = middle[middle.length - 1];
            if (this.isStructure(tail, isRichMode)) {
              suffix = tail;
              middle = middle.slice(0, -1);
            }
          }

          const hasIndentedStructuralWalls =
            indentation.length > 0 &&
            prefix.length > 0 &&
            suffix.length > 0 &&
            this.isStructure(prefix, isRichMode) &&
            this.isStructure(suffix, isRichMode);
          // Nested boxes often rely on manual indentation; avoid forcing these lines.
          if (hasIndentedStructuralWalls && diff > 0) {
            return stat.line;
          }

          const trimmedMiddle = middle.trim();
          let centeredContent: string | null = null;
          if (
            trimmedMiddle.startsWith('^') &&
            trimmedMiddle.endsWith('^') &&
            trimmedMiddle.length > 2
          ) {
            centeredContent = trimmedMiddle;
          } else if (
            trimmedMiddle.startsWith('^') &&
            trimmedMiddle.length > 1 &&
            trimmedMiddle !== '^^'
          ) {
            centeredContent = trimmedMiddle;
          }

          if (diff <= 0 && centeredContent === null) {
            return stat.line;
          }

          if (centeredContent !== null) {
            // Centering keeps markers in the text pipeline while balancing visual spacing.
            const availableWidth =
              maxVisWidth - this.getTextDisplayWidth(indentation + prefix + suffix, isRichMode);
            const contentWidth = this.getTextDisplayWidth(centeredContent, isRichMode);
            const totalPadding = Math.max(0, availableWidth - contentWidth);
            const leftPad = Math.floor(totalPadding / 2);
            const rightPad = totalPadding - leftPad;
            return (
              indentation +
              prefix +
              ' '.repeat(leftPad) +
              centeredContent +
              ' '.repeat(rightPad) +
              suffix
            );
          }

          if (suffix) {
            // When a right boundary exists, fill toward it to keep box edges aligned.
            let fillChar = ' ';
            const coreContent = middle.replace(/[+v^<>|]/g, '');
            const isStructural = /^[-─═]+$/.test(coreContent);
            const isEmptyStructural =
              middle.length === 0 && /[+┌┐└┘├┤┬┴┼]/.test(prefix) && /[+┌┐└┘├┤┬┴┼]/.test(suffix);

            if (isStructural || isEmptyStructural) {
              if (middle.includes('═') || prefix === '═') fillChar = '═';
              else if (middle.includes('─') || prefix === '─') fillChar = '─';
              else fillChar = '-';
            }
            return indentation + prefix + middle + fillChar.repeat(diff) + suffix;
          }

          return stat.line;
        })
        .join('\n');
    });

    return formattedBlocks.join('\n');
  }

  /**
   * Converts ASCII/Unicode diagram text into an SVG element.
   *
   * Rendering passes:
   * 1) Build a grapheme-aware grid with coordinates.
   * 2) Draw horizontal and vertical structural paths.
   * 3) Detect text zones and place aligned text nodes.
   */
  public render(ascii: string): SVGSVGElement {
    if (typeof document === 'undefined') {
      throw new Error('SmoothScrub.render() requires a DOM environment (window.document).');
    }

    const isRichMode = this.detectRichMode(ascii);
    const lines = ascii.split('\n');
    const grid: GridCell[][] = [];
    let maxPixelW = 0;
    const maxRow = lines.length;

    lines.forEach((line, r) => {
      const rowData: GridCell[] = [];
      let currentX = this.cw;
      const y = r * this.ch + this.ch;

      const graphemes = this.splitGraphemes(line);

      graphemes.forEach((grapheme) => {
        const widthUnits = this.getDisplayWidth(grapheme, isRichMode);
        const pxWidth = widthUnits * this.cw;

        rowData.push({
          char: grapheme,
          x: currentX,
          y: y,
          cx: currentX + pxWidth / 2,
          cy: y + this.ch / 2,
          w: pxWidth,
          cols: widthUnits,
        });
        currentX += pxWidth;
      });
      // Track max width to size the final SVG viewBox.
      grid.push(rowData);
      if (currentX > maxPixelW) maxPixelW = currentX;
    });

    const width = maxPixelW + this.cw;
    const height = maxRow * this.ch + this.ch * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const pathGroup = document.createElementNS(ns, 'path');
    pathGroup.setAttribute('stroke', this.color);
    pathGroup.setAttribute('stroke-width', this.strokeWidth.toString());
    pathGroup.setAttribute('fill', 'none');
    pathGroup.setAttribute('stroke-linecap', 'butt');
    pathGroup.setAttribute('stroke-linejoin', 'round');

    const textGroup = document.createElementNS(ns, 'g');
    let d = '';

    // Pass 1: draw horizontal structural segments.
    grid.forEach((row) => {
      const canConnectHorizontally = (left: GridCell, right: GridCell) =>
        this.isStructure(left.char, isRichMode) &&
        this.isStructure(right.char, isRichMode) &&
        Math.abs(right.x - (left.x + left.w)) < 2;

      let i = 0;
      while (i < row.length - 1) {
        const curr = row[i];
        const next = row[i + 1];

        if (!canConnectHorizontally(curr, next)) {
          i += 1;
          continue;
        }

        d += `M ${curr.cx},${curr.cy} `;

        let j = i;
        while (j < row.length - 1 && canConnectHorizontally(row[j], row[j + 1])) {
          const to = row[j + 1];
          d += `L ${to.cx},${to.cy} `;
          j += 1;
        }

        i = j;
      }
    });

    // Pass 2: draw vertical structural segments.
    const verticalRuns = this.detectVerticalRuns(grid, isRichMode);
    verticalRuns.forEach((run) => {
      const firstCell = run.cells[0];
      const lastCell = run.cells[run.cells.length - 1];

      let startY = firstCell.cy - this.ch / 2;
      let endY = lastCell.cy + this.ch / 2;

      if (this.shouldStartAtCenter(firstCell.char, isRichMode)) {
        startY = firstCell.cy;
      }

      if (this.shouldEndAtCenter(lastCell.char, isRichMode)) {
        endY = lastCell.cy;
      }

      d += `M ${run.cx},${startY} L ${run.cx},${endY} `;

      for (let index = 1; index < run.cells.length - 1; index += 1) {
        const midY = run.cells[index].cy;
        if (Math.abs(midY - startY) > 0.01 && Math.abs(midY - endY) > 0.01) {
          d += `M ${run.cx},${midY} L ${run.cx},${midY} `;
        }
      }
    });

    const isAsciiZoneConnector = (rowIndex: number, colIndex: number): boolean => {
      // Zone connectors are structural glyphs that should not be emitted as text.
      if (isRichMode) return false;

      const row = grid[rowIndex];
      const cell = row?.[colIndex];
      if (!cell) return false;

      const char = cell.char;
      if (char !== '-' && char !== '|' && char !== '+' && char !== 'v') return false;

      const leftChar = row[colIndex - 1]?.char;
      const rightChar = row[colIndex + 1]?.char;
      const upChar = grid[rowIndex - 1]?.[colIndex]?.char;
      const downChar = grid[rowIndex + 1]?.[colIndex]?.char;

      const isHorizontal = (value: string | undefined) =>
        value === '-' || value === '+' || value === '=' || value === '_';
      const isVertical = (value: string | undefined) => value === '|' || value === '+';

      if (char === '-') {
        return isHorizontal(leftChar) || isHorizontal(rightChar);
      }

      if (char === '|') {
        return isVertical(upChar) || isVertical(downChar);
      }

      const hasHorizontal = isHorizontal(leftChar) || isHorizontal(rightChar);
      const hasVertical = isVertical(upChar) || isVertical(downChar);
      return hasHorizontal && hasVertical;
    };

    // Pass 3: extract text zones between structural walls and render text nodes.
    grid.forEach((row, rowIndex) => {
      const walls: { i: number; x: number }[] = [];
      row.forEach((cell, i) => {
        let isWall = this.isVert(cell.char, isRichMode) || this.isCorner(cell.char);

        if (!isRichMode && cell.char === '+' && !isWall) {
          const leftChar = row[i - 1]?.char;
          const rightChar = row[i + 1]?.char;
          const upChar = grid[rowIndex - 1]?.[i]?.char;
          const downChar = grid[rowIndex + 1]?.[i]?.char;

          const hasHorizontalBox =
            leftChar === '-' || leftChar === '+' || rightChar === '-' || rightChar === '+';
          const hasVerticalBox =
            upChar === '|' || upChar === '+' || downChar === '|' || downChar === '+';

          isWall = hasHorizontalBox || hasVerticalBox;
        }

        if (isWall) {
          walls.push({ i, x: cell.x });
        }
      });

      const zones: Zone[] = [];
      // If no clear walls exist, treat the full row as one text zone.
      if (walls.length < 2) {
        zones.push({
          start: 0,
          end: row.length,
          leftX: this.cw,
          rightX: width - this.cw,
        });
      } else {
        for (let k = 0; k < walls.length - 1; k++) {
          const w1 = walls[k];
          const w2 = walls[k + 1];
          const leftX = row[w1.i].x + row[w1.i].w;
          const rightX = row[w2.i].x;
          zones.push({ start: w1.i + 1, end: w2.i, leftX, rightX });
        }
      }

      zones.forEach((zone) => {
        let rawString = '';
        const cellMap: GridCell[] = [];

        for (let k = zone.start; k < zone.end; k++) {
          if (row[k]) {
            if (isAsciiZoneConnector(rowIndex, k)) {
              continue;
            }
            rawString += row[k].char;
            cellMap.push(row[k]);
          }
        }
        if (!rawString.trim()) return;

        const createTextNode = (
          text: string,
          align: 'start' | 'middle' | 'end',
          finalX: number,
          cell: GridCell | undefined,
          preserve: boolean
        ) => {
          // `preserve` keeps intentional internal spacing for centered/balanced text.
          const t = document.createElementNS(ns, 'text');
          t.setAttribute('x', finalX.toString());
          t.setAttribute('y', cell ? (cell.y + this.ch * 0.7).toString() : '0');
          t.setAttribute('text-anchor', align);
          t.setAttribute('fill', '#444');
          t.setAttribute('font-family', 'monospace');
          t.setAttribute('font-weight', 'bold');

          const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(text);
          t.setAttribute('font-size', (hasEmoji ? this.ch * 0.75 : this.cw * 1.35).toString());

          if (preserve) {
            t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
          }

          t.textContent = text;
          textGroup.appendChild(t);
        };

        const trimmed = rawString.trim();
        // Fast path: row-level centered text markers.
        if (trimmed.startsWith('^') && trimmed.endsWith('^') && trimmed.length > 2) {
          const leadingSpaceCount = rawString.length - rawString.trimStart().length;
          const baseCell = cellMap[leadingSpaceCount] ?? cellMap[0];
          const text = trimmed.slice(1, -1);
          const zoneCenter = (zone.leftX + zone.rightX) / 2;
          createTextNode(text, 'middle', zoneCenter, baseCell, true);
          return;
        }

        if (trimmed.startsWith('^') && trimmed.length > 1 && trimmed !== '^^') {
          const leadingSpaceCount = rawString.length - rawString.trimStart().length;
          const baseCell = cellMap[leadingSpaceCount] ?? cellMap[0];
          const text = trimmed.slice(1);
          const zoneCenter = (zone.leftX + zone.rightX) / 2;
          createTextNode(text, 'middle', zoneCenter, baseCell, true);
          return;
        }

        const matches = rawString.matchAll(/\S+(?: [^\s]+)*/g);
        for (const match of matches) {
          let text = match[0];
          const cell = cellMap[match.index ?? 0];

          let align: 'start' | 'middle' | 'end' = 'start';
          // Marker parsing supports leading and trailing alignment hints.
          if (text.startsWith('^') && text.endsWith('^') && text.length > 2) {
            align = 'middle';
            text = text.slice(1, -1);
          } else if (text.startsWith('^') && text.length > 1 && text !== '^^') {
            align = 'middle';
            text = text.substring(1);
          } else if (text.startsWith('>')) {
            align = 'end';
            text = text.substring(1);
          } else if (text.startsWith('<')) {
            align = 'start';
            text = text.substring(1);
          }
          if (text.endsWith('>')) {
            align = 'end';
            text = text.slice(0, -1);
          }
          if (!text) continue;

          let finalX: number;
          const pad = this.cw * 0.8;
          const zoneCenter = (zone.leftX + zone.rightX) / 2;

          if (align === 'middle') {
            finalX = zoneCenter;
          } else if (align === 'end') {
            finalX = zone.rightX - pad;
          } else {
            finalX = cell ? cell.x : zone.leftX + pad;
            if (match[0].startsWith('<')) finalX = zone.leftX + pad;
          }

          createTextNode(text, align, finalX, cell, /\s{2,}/.test(text));
        }
      });
    });

    pathGroup.setAttribute('d', d);
    svg.appendChild(textGroup);
    svg.appendChild(pathGroup);
    return svg;
  }
}
