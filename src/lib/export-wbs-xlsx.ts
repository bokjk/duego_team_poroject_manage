import ExcelJS from "exceljs";

type ExportBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type ExportRow = {
  kind: "task" | "phase";
  group: string;
  wbsCode: string;
  title: string;
  owner: string;
  start: Date;
  end: Date;
  durationDays: number;
  progress: number;
  priorityLabel?: string;
};

type BuildWbsScheduleWorkbookArgs = {
  projectName: string;
  projectCode: string;
  exportedAt: string;
  rangeLabel: string;
  timelineScale: string;
  exportBuckets: ExportBucket[];
  rows: ExportRow[];
  stateGroupLabels: Record<string, string>;
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function formatDateForExport(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildExportMonthGroups(exportBuckets: ExportBucket[]): Array<{ label: string; count: number }> {
  const groups: Array<{ label: string; count: number }> = [];

  for (const bucket of exportBuckets) {
    const label = `${bucket.start.getFullYear()}년 ${bucket.start.getMonth() + 1}월`;
    const last = groups[groups.length - 1];

    if (last && last.label === label) {
      last.count += 1;
    } else {
      groups.push({ label, count: 1 });
    }
  }

  return groups;
}

function buildExportWeekGroups(exportBuckets: ExportBucket[]): Array<{ label: string; count: number }> {
  const groups: Array<{ label: string; count: number }> = [];

  let cursor = 0;
  while (cursor < exportBuckets.length) {
    const start = exportBuckets[cursor];
    let end = start;
    let count = 1;

    while (
      cursor + count < exportBuckets.length &&
      count < 5 &&
      exportBuckets[cursor + count].start.getMonth() === start.start.getMonth() &&
      exportBuckets[cursor + count].start.getFullYear() === start.start.getFullYear()
    ) {
      end = exportBuckets[cursor + count];
      count += 1;
    }

    groups.push({
      label:
        start.start.getMonth() === end.start.getMonth()
          ? `${start.start.getMonth() + 1}/${start.start.getDate()}-${end.start.getDate()}`
          : `${start.start.getMonth() + 1}/${start.start.getDate()}-${end.start.getMonth() + 1}/${end.start.getDate()}`,
      count,
    });

    cursor += count;
  }

  return groups;
}

function doesRangeOverlap(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return start <= rangeEnd && end >= rangeStart;
}

function buildExportGanttCells(
  row: ExportRow,
  exportBuckets: ExportBucket[],
): Array<"done" | "active" | "pending" | "empty"> {
  const overlappingIndexes = exportBuckets
    .map((bucket, index) =>
      doesRangeOverlap(row.start, row.end, bucket.start, bucket.end) ? index : -1,
    )
    .filter((index) => index >= 0);

  if (overlappingIndexes.length === 0) {
    return exportBuckets.map(() => "empty");
  }

  const completedBucketsFloat = (overlappingIndexes.length * row.progress) / 100;
  const completedBuckets = Math.floor(completedBucketsFloat);
  const hasPartialBucket = row.progress > 0 && row.progress < 100 && completedBucketsFloat > completedBuckets;
  let completedCount = 0;
  let partialPlaced = false;

  return exportBuckets.map((_, index) => {
    if (!overlappingIndexes.includes(index)) {
      return "empty";
    }

    if (completedCount < completedBuckets) {
      completedCount += 1;
      return "done";
    }

    if (hasPartialBucket && !partialPlaced) {
      partialPlaced = true;
      return "active";
    }

    return "pending";
  });
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: { argb: "FFCFD7E6" } },
    left: { style: "thin", color: { argb: "FFCFD7E6" } },
    bottom: { style: "thin", color: { argb: "FFCFD7E6" } },
    right: { style: "thin", color: { argb: "FFCFD7E6" } },
  };
}

function applyFill(cell: ExcelJS.Cell, color: string) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: color.replace("#", "FF") },
  };
}

function styleCell(cell: ExcelJS.Cell, options?: { bold?: boolean; color?: string; fill?: string; align?: "left" | "center" }) {
  applyBorder(cell);
  cell.font = {
    name: "Malgun Gothic",
    size: 10,
    bold: options?.bold ?? false,
    color: options?.color ? { argb: options.color.replace("#", "FF") } : undefined,
  };
  if (options?.fill) {
    applyFill(cell, options.fill);
  }
  cell.alignment = {
    vertical: "middle",
    horizontal: options?.align ?? "left",
    wrapText: true,
  };
}

export async function buildWbsScheduleWorkbookBuffer({
  projectName,
  projectCode,
  exportedAt,
  rangeLabel,
  timelineScale,
  exportBuckets,
  rows,
  stateGroupLabels,
}: BuildWbsScheduleWorkbookArgs): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenCode";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Schedule", {
    views: [{ state: "frozen", xSplit: 11, ySplit: timelineScale === "주 단위" ? 5 : 4 }],
  });

  const monthGroups = buildExportMonthGroups(exportBuckets);
  const weekGroups = timelineScale === "주 단위" ? buildExportWeekGroups(exportBuckets) : [];
  const columns = [44, 58, 68, 210, 94, 72, 72, 54, 70, 74, 72, ...exportBuckets.map(() => 24)];
  sheet.columns = columns.map((width) => ({ width: Math.max(width / 7, 4) }));

  const totalColumns = 11 + exportBuckets.length;

  sheet.mergeCells(1, 1, 1, totalColumns);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${projectName} (${projectCode}) Schedule`;
  styleCell(titleCell, { bold: true, color: "#FFFFFF", fill: "#162132", align: "left" });
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, 4);
  sheet.mergeCells(2, 5, 2, 8);
  sheet.mergeCells(2, 9, 2, 11);
  if (exportBuckets.length > 0) {
    sheet.mergeCells(2, 12, 2, totalColumns);
  }
  const metaCells = [
    { col: 1, value: `내보낸 시각: ${exportedAt}` },
    { col: 5, value: `조회 기간: ${rangeLabel}` },
    { col: 9, value: `타임라인 보기: ${timelineScale}` },
    { col: 12, value: "간트 표기: 파랑=완료 / 연파랑=진행중 / 회색=남음" },
  ];
  for (const meta of metaCells) {
    const cell = sheet.getCell(2, meta.col);
    cell.value = meta.value;
    styleCell(cell, { bold: true, fill: meta.col === 12 ? "#F8FAFC" : "#EDF2FB", align: "left" });
  }
  sheet.getRow(2).height = 22;

  const fixedHeaders = ["WBS", "구분", "상태", "작업명", "담당자", "시작일", "종료일", "기간(일)", "진행률(%)", "완료 여부", "우선순위"];
  const fixedHeaderMergeDown = timelineScale === "주 단위" ? 2 : 1;
  fixedHeaders.forEach((label, index) => {
    sheet.mergeCells(3, index + 1, 3 + fixedHeaderMergeDown, index + 1);
    const cell = sheet.getCell(3, index + 1);
    cell.value = label;
    styleCell(cell, { bold: true, color: "#FFFFFF", fill: "#0F172A", align: "center" });
  });

  let currentColumn = 12;
  for (const group of monthGroups) {
    const endColumn = currentColumn + group.count - 1;
    sheet.mergeCells(3, currentColumn, 3, endColumn);
    const cell = sheet.getCell(3, currentColumn);
    cell.value = group.label;
    styleCell(cell, { bold: true, color: "#1D4ED8", fill: "#DBEAFE", align: "center" });
    currentColumn = endColumn + 1;
  }

  if (timelineScale === "주 단위") {
    currentColumn = 12;
    for (const group of weekGroups) {
      const endColumn = currentColumn + group.count - 1;
      sheet.mergeCells(4, currentColumn, 4, endColumn);
      const cell = sheet.getCell(4, currentColumn);
      cell.value = group.label;
      styleCell(cell, { bold: true, color: "#92400E", fill: "#FEF3C7", align: "center" });
      currentColumn = endColumn + 1;
    }

    exportBuckets.forEach((bucket, index) => {
      const cell = sheet.getCell(5, index + 12);
      cell.value = WEEKDAY_LABELS[bucket.start.getDay()] ?? "";
      styleCell(cell, { bold: true, color: "#FFFFFF", fill: "#1E293B", align: "center" });
    });
    sheet.getRow(5).height = 18;
  } else {
    exportBuckets.forEach((bucket, index) => {
      const cell = sheet.getCell(4, index + 12);
      cell.value = bucket.label;
      styleCell(cell, { bold: true, color: "#92400E", fill: "#FEF3C7", align: "center" });
    });
  }
  sheet.getRow(3).height = 22;
  sheet.getRow(4).height = 20;

  rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + (timelineScale === "주 단위" ? 6 : 5);
    const excelJsRow = sheet.getRow(excelRow);
    excelJsRow.height = 22;
    const isPhase = row.kind === "phase";
    const rowFill = isPhase ? "#EFF6FF" : undefined;

    const cells = [
      row.wbsCode,
      isPhase ? "상태 그룹" : "작업",
      stateGroupLabels[row.group] ?? row.group,
      row.title,
      row.owner,
      formatDateForExport(row.start),
      formatDateForExport(row.end),
      row.durationDays,
      row.progress,
      !isPhase ? (row.group === "completed" ? "완료" : "미완료") : "",
      !isPhase ? row.priorityLabel ?? "" : "",
    ];

    cells.forEach((value, index) => {
      const cell = sheet.getCell(excelRow, index + 1);
      cell.value = value;
      const align = index === 3 || index === 4 ? "left" : "center";
      styleCell(cell, { bold: isPhase, fill: rowFill, align });
      if (index === 9 && !isPhase) {
        cell.font = {
          ...cell.font,
          color: { argb: row.group === "completed" ? "FF047857" : "FFB45309" },
          bold: true,
        };
      }
    });

    exportBuckets.forEach((_, bucketIndex) => {
      const state = buildExportGanttCells(row, exportBuckets)[bucketIndex];
      const cell = sheet.getCell(excelRow, bucketIndex + 12);
      styleCell(cell, { fill: state === "done" ? "#2563EB" : state === "active" ? "#93C5FD" : state === "pending" ? "#E5E7EB" : "#FFFFFF", align: "center" });
      cell.value = "";
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
