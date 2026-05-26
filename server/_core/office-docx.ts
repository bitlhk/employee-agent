import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const FONT = "Microsoft YaHei";
const EAST_ASIA_FONT = "Microsoft YaHei";

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function textRun(text: string, options: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text,
    bold: options.bold,
    size: options.size || 22,
    color: options.color || "1f2937",
    font: {
      ascii: FONT,
      eastAsia: EAST_ASIA_FONT,
      hAnsi: FONT,
    },
  });
}

function paragraph(
  text: string,
  options: {
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    bullet?: boolean;
    spacingAfter?: number;
    bold?: boolean;
    size?: number;
    color?: string;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {}
) {
  return new Paragraph({
    heading: options.heading,
    bullet: options.bullet ? { level: 0 } : undefined,
    alignment: options.alignment,
    spacing: { after: options.spacingAfter ?? 140 },
    children: [textRun(stripMarkdown(text), options)],
  });
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => stripMarkdown(cell));
}

function tableFromRows(rows: string[][]) {
  const columnCount = Math.max(...rows.map(row => row.length), 1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "d1d5db" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "d1d5db" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "d1d5db" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "d1d5db" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "e5e7eb" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "e5e7eb" },
    },
    rows: rows.map((row, rowIndex) =>
      new TableRow({
        children: Array.from({ length: columnCount }).map((_, index) =>
          new TableCell({
            shading: rowIndex === 0 ? { fill: "f3f4f6" } : undefined,
            width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [
              paragraph(row[index] || "", {
                bold: rowIndex === 0,
                spacingAfter: 0,
                size: 20,
              }),
            ],
          })
        ),
      })
    ),
  });
}

function markdownToBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<Paragraph | Table> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    const line = raw.trim();
    if (!line) {
      blocks.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableDivider(lines[index + 1])) {
      const rows = [parseTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index]?.includes("|")) {
        rows.push(parseTableRow(lines[index] || ""));
        index += 1;
      }
      index -= 1;
      blocks.push(tableFromRows(rows));
      blocks.push(new Paragraph({ spacing: { after: 180 } }));
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        paragraph(heading[2], {
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          bold: true,
          size: level === 1 ? 32 : level === 2 ? 26 : 23,
          color: level === 1 ? "0f3a5f" : "1f4f7a",
          spacingAfter: 160,
        })
      );
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line) || /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push(paragraph(bullet[1], { bullet: true, spacingAfter: 80 }));
      continue;
    }

    blocks.push(paragraph(line));
  }

  return blocks;
}

export async function markdownToDocxBuffer(args: {
  title: string;
  markdown: string;
  disclaimer?: string;
}) {
  const children: Array<Paragraph | Table> = [
    paragraph(args.title, {
      heading: HeadingLevel.TITLE,
      bold: true,
      size: 36,
      color: "0f3a5f",
      alignment: AlignmentType.CENTER,
      spacingAfter: 260,
    }),
    ...markdownToBlocks(args.markdown),
  ];

  if (args.disclaimer) {
    children.push(
      paragraph(args.disclaimer, {
        size: 18,
        color: "64748b",
        spacingAfter: 0,
      })
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: 22,
          },
          paragraph: {
            spacing: { line: 320 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1260,
              bottom: 1440,
              left: 1260,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
