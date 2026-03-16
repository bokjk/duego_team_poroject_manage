"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./page.module.scss";

type AssigneeInfo = {
  id: string;
  display_name: string;
  first_name: string | null;
};

type WbsRow = {
  id: string;
  sequence_id: number | null;
  name: string;
  state_id: string;
  state_name: string;
  state_color: string;
  state_group: string;
  assignees: AssigneeInfo[];
  priority: string;
  difficulty: string;
  difficulty_weight: number;
  start_date: string | null;
  due_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  parent: string | null;
};

type WbsResponse = {
  project: {
    id: string;
    name: string;
    identifier: string;
    description: string | null;
  };
  summary: {
    total: number;
    completed: number;
    in_progress: number;
    todo: number;
    backlog: number;
    cancelled: number;
    completion_rate: number;
  };
  filters: {
    available_state_groups: string[];
    available_priorities: string[];
    available_assignees: AssigneeInfo[];
    available_difficulties: string[];
  };
  rows: WbsRow[];
};

type ApiErrorResponse = {
  error?: string;
};

type AppliedFilters = {
  stateGroups: string[];
  members: string[];
  priority: string[];
  difficulty: string[];
  progressMode: "all" | "exclude_completed" | "completed_only";
  dateFrom: string;
  dateTo: string;
};

type TaskPresentationRow = {
  kind: "task";
  key: string;
  group: string;
  wbsCode: string;
  title: string;
  owner: string;
  start: Date;
  end: Date;
  durationDays: number;
  progress: number;
  priority: string;
  priorityLabel: string;
  difficultyLabel: string;
  leftPct: number;
  widthPct: number;
  barColor: string;
};

type PhasePresentationRow = {
  kind: "phase";
  key: string;
  group: string;
  wbsCode: string;
  title: string;
  owner: string;
  start: Date;
  end: Date;
  durationDays: number;
  progress: number;
  leftPct: number;
  widthPct: number;
  barColor: string;
  taskCount: number;
};

type PresentationRow = TaskPresentationRow | PhasePresentationRow;

type TimelineDay = {
  key: string;
  date: Date;
  label: string;
  weekend: boolean;
};

type TimelineMarker = {
  key: string;
  label: string;
  compactLabel?: string;
  start: Date;
  end: Date;
  leftPct: number;
  widthPct: number;
};

type TimelineModel = {
  monthMarkers: TimelineMarker[];
  weekMarkers: TimelineMarker[];
  days: TimelineDay[];
  rows: PresentationRow[];
  totalDays: number;
  todayPct: number | null;
};

const STATE_GROUP_LABELS: Record<string, string> = {
  backlog: "백로그",
  unstarted: "할 일",
  started: "진행중",
  completed: "완료",
  cancelled: "취소",
};

const PROGRESS_FILTER_LABELS = {
  all: "전체",
  exclude_completed: "완료 제외",
  completed_only: "완료만",
} as const;

const PRIORITY_LABELS: Record<string, string> = {
  none: "없음",
  low: "낮음",
  medium: "보통",
  high: "높음",
  urgent: "긴급",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  하: "하 (1점)",
  중: "중 (3점)",
  상: "상 (5점)",
};

const STATE_GROUP_ACCENT: Record<string, string> = {
  backlog: "#6b7280",
  unstarted: "#6366f1",
  started: "#f59e0b",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

const DISPLAY_ORDER = ["started", "unstarted", "backlog", "completed"] as const;
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_IN_MS = 1000 * 60 * 60 * 24;
const DEFAULT_DURATION_WORK_DAYS = 5;
const WORK_DAYS_PER_WEEK = 5;
const DRAG_SCROLL_SPEED = 2.25;
const DETAIL_COLUMNS_WIDTH = 0;
const EMPTY_FILTERS: AppliedFilters = {
  stateGroups: [],
  members: [],
  priority: [],
  difficulty: [],
  progressMode: "all",
  dateFrom: "",
  dateTo: "",
};

function parseProjectId(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    if (payload.error) {
      return payload.error;
    }
  } catch {
    return `요청 실패 (${response.status})`;
  }

  return `요청 실패 (${response.status})`;
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function isWeekend(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

function moveToNextWorkday(date: Date): Date {
  let cursor = startOfDay(date);

  while (isWeekend(cursor)) {
    cursor = addDays(cursor, 1);
  }

  return cursor;
}

function moveToPreviousWorkday(date: Date): Date {
  let cursor = startOfDay(date);

  while (isWeekend(cursor)) {
    cursor = addDays(cursor, -1);
  }

  return cursor;
}

function addBusinessDays(date: Date, amount: number): Date {
  let cursor = startOfDay(date);

  if (amount === 0) {
    return isWeekend(cursor) ? moveToNextWorkday(cursor) : cursor;
  }

  const direction = amount > 0 ? 1 : -1;
  let remaining = Math.abs(amount);

  while (remaining > 0) {
    cursor = addDays(cursor, direction);
    if (!isWeekend(cursor)) {
      remaining -= 1;
    }
  }

  return cursor;
}

function differenceInBusinessDays(start: Date, end: Date): number {
  const normalizedStart = moveToNextWorkday(start);
  const normalizedEnd = moveToPreviousWorkday(end);

  if (normalizedEnd < normalizedStart) {
    return 1;
  }

  let count = 0;
  let cursor = normalizedStart;

  while (cursor <= normalizedEnd) {
    if (!isWeekend(cursor)) {
      count += 1;
    }
    cursor = addDays(cursor, 1);
  }

  return Math.max(count, 1);
}

function getBusinessDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  const normalizedEnd = startOfDay(end);

  while (cursor <= normalizedEnd) {
    if (!isWeekend(cursor)) {
      days.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }

  return days;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function shiftMonthClamped(date: Date, delta: number): Date {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + delta;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(date.getDate(), lastDayOfTargetMonth);

  return new Date(targetYear, targetMonth, targetDay);
}

function getDefaultDateWindow(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const start = shiftMonthClamped(today, -1);
  const end = shiftMonthClamped(today, 1);

  return {
    dateFrom: formatDateInputValue(start),
    dateTo: formatDateInputValue(end),
  };
}

function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatKoreanFullDate(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatDateForExport(date: Date): string {
  return formatDateInputValue(date);
}

function escapeSpreadsheetText(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;

  return safe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildExportMonthGroups(
  exportBuckets: Array<{ key: string; label: string; start: Date; end: Date }>,
): Array<{ label: string; count: number }> {
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

function buildSpreadsheetMlContent({
  projectName,
  projectCode,
  exportedAt,
  rangeLabel,
  timelineScale,
  exportBuckets,
  rows,
}: {
  projectName: string;
  projectCode: string;
  exportedAt: string;
  rangeLabel: string;
  timelineScale: string;
  exportBuckets: Array<{ key: string; label: string; start: Date; end: Date }>;
  rows: PresentationRow[];
}): string {
  const monthGroups = buildExportMonthGroups(exportBuckets);
  const totalColumns = 11 + exportBuckets.length;
  const buildCell = ({
    value = "",
    type = "String",
    styleId = "Cell",
    mergeAcross,
    mergeDown,
    index,
  }: {
    value?: string | number;
    type?: "String" | "Number";
    styleId?: string;
    mergeAcross?: number;
    mergeDown?: number;
    index?: number;
  }) => {
    const attrs = [
      index ? ` ss:Index="${index}"` : "",
      styleId ? ` ss:StyleID="${styleId}"` : "",
      mergeAcross !== undefined ? ` ss:MergeAcross="${mergeAcross}"` : "",
      mergeDown !== undefined ? ` ss:MergeDown="${mergeDown}"` : "",
    ].join("");
    return `<Cell${attrs}><Data ss:Type="${type}">${escapeSpreadsheetText(value)}</Data></Cell>`;
  };

  const monthHeaderCells = monthGroups
    .map((group) => buildCell({ value: group.label, styleId: "MonthBand", mergeAcross: group.count - 1 }))
    .join("");

  const weekHeaderCells = exportBuckets
    .map((bucket, index) =>
      buildCell({ value: bucket.label, styleId: "WeekBand", index: index === 0 ? 12 : undefined }),
    )
    .join("");

  const bodyRows = rows
    .map((row) => {
      const ganttCells = buildExportGanttCells(row, exportBuckets)
        .map((cell) => {
          const styleId =
            cell === "done"
              ? "GanttDone"
              : cell === "active"
                ? "GanttActive"
                : cell === "pending"
                  ? "GanttPending"
                  : "GanttEmpty";
          return buildCell({ value: "", styleId });
        })
        .join("");

      const rowStyle = row.kind === "phase" ? "PhaseCell" : "Cell";
      const completionText = row.kind === "task" ? (row.group === "completed" ? "완료" : "미완료") : "";
      const completionStyle = row.group === "completed" ? "CompletionDone" : "CompletionOpen";
      const priorityText = row.kind === "task" ? row.priorityLabel : "";

      return `<Row ss:AutoFitHeight="0" ss:Height="22">
        ${buildCell({ value: row.wbsCode, styleId: `${rowStyle}Center` })}
        ${buildCell({ value: row.kind === "phase" ? "상태 그룹" : "작업", styleId: `${rowStyle}Center` })}
        ${buildCell({ value: STATE_GROUP_LABELS[row.group] ?? row.group, styleId: `${rowStyle}Center` })}
        ${buildCell({ value: row.title, styleId: rowStyle })}
        ${buildCell({ value: row.owner, styleId: rowStyle })}
        ${buildCell({ value: formatDateForExport(row.start), styleId: `${rowStyle}Center` })}
        ${buildCell({ value: formatDateForExport(row.end), styleId: `${rowStyle}Center` })}
        ${buildCell({ value: row.durationDays, styleId: `${rowStyle}Center`, type: "Number" })}
        ${buildCell({ value: row.progress, styleId: `${rowStyle}Center`, type: "Number" })}
        ${buildCell({ value: completionText, styleId: completionText ? completionStyle : `${rowStyle}Center` })}
        ${buildCell({ value: priorityText, styleId: `${rowStyle}Center` })}
        ${ganttCells}
      </Row>`;
    })
    .join("");

  const columnWidths = [44, 58, 68, 210, 94, 72, 72, 54, 70, 74, 72, ...exportBuckets.map(() => 24)];
  const columnsXml = columnWidths.map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${width}"/>`).join("");
  const rowCount = 4 + rows.length;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>OpenCode</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
  <ProtectStructure>False</ProtectStructure>
  <ProtectWindows>False</ProtectWindows>
 </ExcelWorkbook>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD7E6"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD7E6"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD7E6"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD7E6"/>
   </Borders>
   <Font ss:FontName="Malgun Gothic" ss:Size="10"/>
  </Style>
  <Style ss:ID="Title" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Size="16" ss:Color="#FFFFFF"/><Interior ss:Color="#162132" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/></Style>
  <Style ss:ID="MetaHead" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1"/><Interior ss:Color="#EDF2FB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Legend" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Size="9" ss:Color="#475569"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="HeaderFixed" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F172A" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="MonthBand" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Color="#1D4ED8"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="WeekBand" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Color="#92400E"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="Cell" ss:Parent="Default"><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="CellCenter" ss:Parent="Default"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="PhaseCell" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1"/><Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="PhaseCellCenter" ss:Parent="PhaseCell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="CompletionDone" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Color="#047857"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="CompletionOpen" ss:Parent="Default"><Font ss:FontName="Malgun Gothic" ss:Bold="1" ss:Color="#B45309"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
  <Style ss:ID="GanttDone" ss:Parent="Default"><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="GanttActive" ss:Parent="Default"><Interior ss:Color="#93C5FD" ss:Pattern="Solid"/></Style>
  <Style ss:ID="GanttPending" ss:Parent="Default"><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="GanttEmpty" ss:Parent="Default"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Schedule">
  <Table ss:ExpandedColumnCount="${totalColumns}" ss:ExpandedRowCount="${rowCount}" x:FullColumns="1" x:FullRows="1">
   ${columnsXml}
   <Row ss:AutoFitHeight="0" ss:Height="28">${buildCell({ value: `${projectName} (${projectCode}) Schedule`, styleId: "Title", mergeAcross: totalColumns - 1 })}</Row>
   <Row ss:AutoFitHeight="0" ss:Height="22">
    ${buildCell({ value: `내보낸 시각: ${exportedAt}`, styleId: "MetaHead", mergeAcross: 3 })}
    ${buildCell({ value: `조회 기간: ${rangeLabel}`, styleId: "MetaHead", mergeAcross: 3 })}
    ${buildCell({ value: `타임라인 보기: ${timelineScale}`, styleId: "MetaHead", mergeAcross: 2 })}
    ${buildCell({ value: `간트 표기: 파랑=완료 / 연파랑=진행중 / 회색=남음`, styleId: "Legend", mergeAcross: exportBuckets.length - 1 })}
   </Row>
   <Row ss:AutoFitHeight="0" ss:Height="22">
    ${buildCell({ value: "WBS", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "구분", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "상태", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "작업명", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "담당자", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "시작일", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "종료일", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "기간(일)", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "진행률(%)", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "완료 여부", styleId: "HeaderFixed", mergeDown: 1 })}
    ${buildCell({ value: "우선순위", styleId: "HeaderFixed", mergeDown: 1 })}
    ${monthHeaderCells}
   </Row>
   <Row ss:AutoFitHeight="0" ss:Height="20">${weekHeaderCells}</Row>
   ${bodyRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <Selected/>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function buildExportBucketHeaders(
  timelineScale: "week" | "month",
  weekMarkers: TimelineMarker[],
  days: TimelineDay[],
): Array<{ key: string; label: string; start: Date; end: Date }> {
  if (timelineScale === "month") {
    return weekMarkers.map((marker) => ({
      key: marker.key,
      label: `${marker.start.getFullYear()}년 ${marker.start.getMonth() + 1}월 ${marker.compactLabel ?? marker.label}`,
      start: marker.start,
      end: marker.end,
    }));
  }

  return days.map((day) => ({
    key: day.key,
    label: formatDateInputValue(day.date),
    start: day.date,
    end: day.date,
  }));
}

function doesRangeOverlap(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return start <= rangeEnd && end >= rangeStart;
}

function buildExportGanttCells(
  row: PresentationRow,
  exportBuckets: Array<{ key: string; label: string; start: Date; end: Date }>,
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

  return exportBuckets.map((bucket, index) => {
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

function getAssigneeLabel(assignees: AssigneeInfo[]): string {
  if (assignees.length === 0) {
    return "미할당";
  }

  const primaryName = assignees[0].first_name ?? assignees[0].display_name;
  return assignees.length > 1
    ? `${primaryName} 외 ${assignees.length - 1}명`
    : primaryName;
}

function getPriorityClassName(priority: string): string {
  switch (priority) {
    case "urgent":
      return styles.priorityUrgent;
    case "high":
      return styles.priorityHigh;
    case "medium":
      return styles.priorityMedium;
    case "low":
      return styles.priorityLow;
    default:
      return styles.priorityNone;
  }
}

function getProgressPercent(stateGroup: string): number {
  switch (stateGroup) {
    case "completed":
      return 100;
    case "started":
      return 60;
    case "unstarted":
      return 20;
    case "backlog":
      return 5;
    default:
      return 0;
  }
}

function makeToggler(setter: Dispatch<SetStateAction<string[]>>) {
  return (value: string) => {
    setter((previous) =>
      previous.includes(value)
        ? previous.filter((entry) => entry !== value)
        : [...previous, value],
    );
  };
}

function buildMonthMarkers(workdays: Date[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const totalDays = Math.max(workdays.length, 1);
  let cursor = 0;

  while (cursor < workdays.length) {
    const segmentStart = workdays[cursor];
    let segmentEnd = segmentStart;
    let width = 1;

    while (
      cursor + width < workdays.length &&
      workdays[cursor + width].getMonth() === segmentStart.getMonth() &&
      workdays[cursor + width].getFullYear() === segmentStart.getFullYear()
    ) {
      segmentEnd = workdays[cursor + width];
      width += 1;
    }

    markers.push({
      key: `month-${segmentStart.getFullYear()}-${segmentStart.getMonth()}`,
      label: `${segmentStart.getFullYear()}년 ${segmentStart.getMonth() + 1}월`,
      start: segmentStart,
      end: segmentEnd,
      leftPct: (cursor / totalDays) * 100,
      widthPct: (width / totalDays) * 100,
    });

    cursor += width;
  }

  return markers;
}

function buildWeekMarkers(workdays: Date[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const totalDays = Math.max(workdays.length, 1);
  let cursor = 0;
  let weekIndexInMonth = 1;

  while (cursor < workdays.length) {
    const segmentStart = workdays[cursor];
    let segmentEnd = segmentStart;
    let width = 1;

    while (
      cursor + width < workdays.length &&
      width < WORK_DAYS_PER_WEEK &&
      workdays[cursor + width].getMonth() === segmentStart.getMonth() &&
      workdays[cursor + width].getFullYear() === segmentStart.getFullYear()
    ) {
      segmentEnd = workdays[cursor + width];
      width += 1;
    }

    markers.push({
      key: `week-${segmentStart.getFullYear()}-${segmentStart.getMonth()}-${weekIndexInMonth}`,
      label:
        segmentStart.getMonth() === segmentEnd.getMonth()
          ? `${segmentStart.getMonth() + 1}/${segmentStart.getDate()}-${segmentEnd.getDate()}`
          : `${segmentStart.getMonth() + 1}/${segmentStart.getDate()}-${segmentEnd.getMonth() + 1}/${segmentEnd.getDate()}`,
      compactLabel: `${weekIndexInMonth}주`,
      start: segmentStart,
      end: segmentEnd,
      leftPct: (cursor / totalDays) * 100,
      widthPct: (width / totalDays) * 100,
    });

    const nextStart = workdays[cursor + width];
    weekIndexInMonth =
      nextStart && nextStart.getMonth() === segmentStart.getMonth() ? weekIndexInMonth + 1 : 1;
    cursor += width;
  }

  return markers;
}

function buildWbsCodeMap(rows: WbsRow[]): { codes: Map<string, string>; hasHierarchy: boolean } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, WbsRow[]>();
  const roots: WbsRow[] = [];
  let hasHierarchy = false;

  for (const row of rows) {
    if (row.parent && byId.has(row.parent)) {
      hasHierarchy = true;
      const siblings = children.get(row.parent) ?? [];
      siblings.push(row);
      children.set(row.parent, siblings);
    } else {
      roots.push(row);
    }
  }

  const codes = new Map<string, string>();

  const visit = (row: WbsRow, prefix: string) => {
    codes.set(row.id, prefix);
    const descendants = children.get(row.id) ?? [];

    descendants.forEach((child, index) => {
      visit(child, `${prefix}.${index + 1}`);
    });
  };

  roots.forEach((root, index) => {
    visit(root, `${index + 1}`);
  });

  return { codes, hasHierarchy };
}

function isTimelineDragTarget(target: EventTarget | null, styles: Record<string, string>): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(`.${styles.timelineHeaderCell}`) ||
      target.closest(`.${styles.timelineCell}`) ||
      target.closest(`.${styles.timelineTrack}`),
  );
}

function snapBarToWeekBuckets(
  start: Date,
  end: Date,
  weekMarkers: TimelineMarker[],
  fallbackLeftPct: number,
  fallbackWidthPct: number,
): { leftPct: number; widthPct: number } {
  const firstMarker =
    weekMarkers.find((marker) => start <= marker.end && end >= marker.start) ??
    weekMarkers.find((marker) => start <= marker.end);
  const lastMarker =
    [...weekMarkers].reverse().find((marker) => end >= marker.start && start <= marker.end) ??
    [...weekMarkers].reverse().find((marker) => end >= marker.start);

  if (!firstMarker || !lastMarker) {
    return { leftPct: fallbackLeftPct, widthPct: fallbackWidthPct };
  }

  const leftPct = firstMarker.leftPct;
  const rightPct = lastMarker.leftPct + lastMarker.widthPct;

  return {
    leftPct,
    widthPct: Math.max(rightPct - leftPct, firstMarker.widthPct),
  };
}

function uniformizeMarkerWidths(markers: TimelineMarker[]): TimelineMarker[] {
  if (markers.length === 0) {
    return markers;
  }

  const uniformWidth = 100 / markers.length;

  return markers.map((marker, index) => ({
    ...marker,
    leftPct: index * uniformWidth,
    widthPct: uniformWidth,
  }));
}

function buildUniformMonthMarkers(weekMarkers: TimelineMarker[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  let cursor = 0;

  while (cursor < weekMarkers.length) {
    const segmentStart = weekMarkers[cursor];
    let segmentEnd = segmentStart;

    while (
      cursor + 1 < weekMarkers.length &&
      weekMarkers[cursor + 1].start.getMonth() === segmentStart.start.getMonth() &&
      weekMarkers[cursor + 1].start.getFullYear() === segmentStart.start.getFullYear()
    ) {
      cursor += 1;
      segmentEnd = weekMarkers[cursor];
    }

    markers.push({
      key: `uniform-month-${segmentStart.start.getFullYear()}-${segmentStart.start.getMonth()}`,
      label: `${segmentStart.start.getFullYear()}년 ${segmentStart.start.getMonth() + 1}월`,
      start: segmentStart.start,
      end: segmentEnd.end,
      leftPct: segmentStart.leftPct,
      widthPct: segmentEnd.leftPct + segmentEnd.widthPct - segmentStart.leftPct,
    });

    cursor += 1;
  }

  return markers;
}

function recomputeTodayPctUniform(today: Date, uniformWeekMarkers: TimelineMarker[]): number | null {
  if (uniformWeekMarkers.length === 0) {
    return null;
  }

  const normalizedToday = isWeekend(today) ? moveToPreviousWorkday(today) : startOfDay(today);
  const containingWeek = uniformWeekMarkers.find(
    (marker) => normalizedToday >= marker.start && normalizedToday <= marker.end,
  );

  if (!containingWeek) {
    return null;
  }

  const segmentSpan = Math.max(differenceInBusinessDays(containingWeek.start, containingWeek.end), 1);
  const segmentOffset = Math.max(differenceInBusinessDays(containingWeek.start, normalizedToday) - 1, 0);
  const ratio = segmentSpan <= 1 ? 0.5 : segmentOffset / (segmentSpan - 1);

  return clamp(containingWeek.leftPct + containingWeek.widthPct * ratio, 0, 100);
}

function buildTimelineModel(rows: WbsRow[]): TimelineModel {
  const today = startOfDay(new Date());
  const taskRows: Array<Omit<TaskPresentationRow, "leftPct" | "widthPct">> = [];
  const { codes, hasHierarchy } = buildWbsCodeMap(rows);

  const grouped = DISPLAY_ORDER.map((group) => ({
    group,
    rows: rows.filter((row) => row.state_group === group),
  })).filter((entry) => entry.rows.length > 0);

  for (const [groupIndex, entry] of grouped.entries()) {
    const phaseCode = `${groupIndex + 1}`;

    for (const [taskIndex, row] of entry.rows.entries()) {
      const rawStart = startOfDay(
        parseDateValue(row.start_date) ?? parseDateValue(row.created_at) ?? today,
      );
      const dueCandidate =
        parseDateValue(row.target_date) ??
        parseDateValue(row.due_date) ??
        parseDateValue(row.completed_at);
      const rawEnd = startOfDay(
        dueCandidate ?? addBusinessDays(rawStart, DEFAULT_DURATION_WORK_DAYS - 1),
      );
      const normalizedStart = moveToNextWorkday(rawStart);
      const normalizedEndCandidate = moveToPreviousWorkday(rawEnd);
      const safeEnd = normalizedEndCandidate < normalizedStart ? normalizedStart : normalizedEndCandidate;

      taskRows.push({
        kind: "task",
        key: row.id,
        group: entry.group,
        wbsCode: hasHierarchy ? (codes.get(row.id) ?? `${phaseCode}.${taskIndex + 1}`) : `${phaseCode}.${taskIndex + 1}`,
        title: row.name,
        owner: getAssigneeLabel(row.assignees),
        start: normalizedStart,
        end: safeEnd,
        durationDays: differenceInBusinessDays(normalizedStart, safeEnd),
        progress: getProgressPercent(entry.group),
        priority: row.priority,
        priorityLabel: PRIORITY_LABELS[row.priority] ?? row.priority,
        difficultyLabel: DIFFICULTY_LABELS[row.difficulty] ?? row.difficulty,
        barColor: STATE_GROUP_ACCENT[entry.group] ?? "#6366f1",
      });
    }
  }

  const minDate = taskRows.length > 0
    ? new Date(Math.min(...taskRows.map((row) => row.start.getTime())))
    : today;
  const maxDate = taskRows.length > 0
    ? new Date(Math.max(...taskRows.map((row) => row.end.getTime())))
    : addBusinessDays(today, 9);

  const timelineStart = addBusinessDays(moveToNextWorkday(minDate), -1);
  const timelineEnd = addBusinessDays(moveToPreviousWorkday(maxDate), 1);
  const workdays = getBusinessDaysInRange(timelineStart, timelineEnd);
  const totalDays = Math.max(workdays.length, 1);
  const workdayIndex = new Map(workdays.map((date, index) => [formatDateInputValue(date), index]));

  const toLeftPct = (date: Date) => {
    const offset = workdayIndex.get(formatDateInputValue(moveToNextWorkday(date))) ?? 0;
    return clamp((offset / totalDays) * 100, 0, 100);
  };

  const toWidthPct = (start: Date, end: Date) => {
    const widthDays = Math.max(differenceInBusinessDays(start, end), 1);
    return Math.max((widthDays / totalDays) * 100, 1.6);
  };

  const rowsWithBars: PresentationRow[] = [];

  for (const [groupIndex, entry] of grouped.entries()) {
    const phaseCode = `${groupIndex + 1}`;
    const tasks = taskRows.filter((row) => row.group === entry.group);

    if (tasks.length === 0) {
      continue;
    }

    const phaseStart = new Date(Math.min(...tasks.map((row) => row.start.getTime())));
    const phaseEnd = new Date(Math.max(...tasks.map((row) => row.end.getTime())));
    const phaseProgress = Math.round(
      tasks.reduce((sum, row) => sum + row.progress, 0) / tasks.length,
    );

    rowsWithBars.push({
      kind: "phase",
      key: `phase-${entry.group}`,
      group: entry.group,
      wbsCode: phaseCode,
      title: `상태 그룹 · ${STATE_GROUP_LABELS[entry.group] ?? entry.group}`,
      owner: `${tasks.length}개 작업`,
      start: phaseStart,
      end: phaseEnd,
      durationDays: differenceInBusinessDays(phaseStart, phaseEnd),
      progress: phaseProgress,
      leftPct: toLeftPct(phaseStart),
      widthPct: toWidthPct(phaseStart, phaseEnd),
      barColor: STATE_GROUP_ACCENT[entry.group] ?? "#6366f1",
      taskCount: tasks.length,
    });

    for (const task of tasks) {
      rowsWithBars.push({
        ...task,
        leftPct: toLeftPct(task.start),
        widthPct: toWidthPct(task.start, task.end),
      });
    }
  }

  const days = workdays.map((date) => ({
    key: `day-${formatDateInputValue(date)}`,
    date,
    label: DAY_LABELS[date.getDay()],
    weekend: false,
  }));

  const monthMarkers = buildMonthMarkers(workdays);
  const weekMarkers = buildWeekMarkers(workdays);

  const todayWorkday = isWeekend(today) ? moveToPreviousWorkday(today) : today;
  const todayIndex = workdayIndex.get(formatDateInputValue(todayWorkday));
  const todayPct = todayIndex === undefined
    ? null
    : clamp((todayIndex / totalDays) * 100, 0, 100);

  return {
    monthMarkers,
    weekMarkers,
    days,
    rows: rowsWithBars,
    totalDays,
    todayPct,
  };
}

export default function WbsPage() {
  const params = useParams<{ projectId: string | string[] }>();
  const projectId = parseProjectId(params?.projectId);
  const boardScrollerRef = useRef<HTMLDivElement>(null);
  const frozenHeaderRef = useRef<HTMLDivElement | null>(null);
  const scrollHeaderRef = useRef<HTMLDivElement | null>(null);
  const frozenRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hasAutoScrolledToTodayRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startScrollLeft: number;
  } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingScrollLeftRef = useRef<number | null>(null);

  const [wbs, setWbs] = useState<WbsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStateGroups, setSelectedStateGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<string[]>([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string[]>([]);
  const [selectedProgressMode, setSelectedProgressMode] = useState<AppliedFilters["progressMode"]>("all");
  const [dateFrom, setDateFrom] = useState(() => getDefaultDateWindow().dateFrom);
  const [dateTo, setDateTo] = useState(() => getDefaultDateWindow().dateTo);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(() => {
    const defaults = getDefaultDateWindow();
    return { ...EMPTY_FILTERS, dateFrom: defaults.dateFrom, dateTo: defaults.dateTo };
  });
  const [timelineScale, setTimelineScale] = useState<"week" | "month">("month");
  const [timelineZoom, setTimelineZoom] = useState(0.75);
  const [selectedTask, setSelectedTask] = useState<TaskPresentationRow | null>(null);

  const toggleStateGroup = makeToggler(setSelectedStateGroups);
  const togglePriority = makeToggler(setSelectedPriority);
  const toggleDifficulty = makeToggler(setSelectedDifficulty);
  const toggleMember = makeToggler(setSelectedMembers);

  const handleApplyFilters = () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return;
    }

    setAppliedFilters({
      stateGroups: [...selectedStateGroups],
      members: [...selectedMembers],
      priority: [...selectedPriority],
      difficulty: [...selectedDifficulty],
      progressMode: selectedProgressMode,
      dateFrom,
      dateTo,
    });
  };

  useEffect(() => {
    if (!projectId) {
      setError("잘못된 프로젝트 ID입니다.");
      setLoading(false);
      return;
    }

    if (appliedFilters.dateFrom && appliedFilters.dateTo && appliedFilters.dateFrom > appliedFilters.dateTo) {
      setLoading(false);
      return;
    }

    const searchParams = new URLSearchParams();
    if (appliedFilters.stateGroups.length > 0) {
      searchParams.set("stateGroups", appliedFilters.stateGroups.join(","));
    }
    if (appliedFilters.members.length > 0) {
      searchParams.set("members", appliedFilters.members.join(","));
    }
    if (appliedFilters.priority.length > 0) {
      searchParams.set("priority", appliedFilters.priority.join(","));
    }
    if (appliedFilters.difficulty.length > 0) {
      searchParams.set("difficulty", appliedFilters.difficulty.join(","));
    }
    if (appliedFilters.progressMode !== "all") {
      searchParams.set("progressMode", appliedFilters.progressMode);
    }
    if (appliedFilters.dateFrom) {
      searchParams.set("dateFrom", appliedFilters.dateFrom);
    }
    if (appliedFilters.dateTo) {
      searchParams.set("dateTo", appliedFilters.dateTo);
    }

    const query = searchParams.toString();
    const requestUrl = `/api/projects/${projectId}/wbs${query ? `?${query}` : ""}`;

    let active = true;
    setLoading(true);

    const fetchWbs = async () => {
      try {
        const response = await fetch(requestUrl, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const payload = (await response.json()) as WbsResponse;

        if (!active) {
          return;
        }

        setWbs(payload);
        setError(null);
      } catch (caughtError) {
        if (!active) {
          return;
        }

        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "WBS 데이터를 불러오지 못했습니다.";

        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchWbs();

    return () => {
      active = false;
    };
  }, [
    projectId,
    appliedFilters,
  ]);

  const timeline = useMemo(
    () => buildTimelineModel(wbs?.rows ?? []),
    [wbs],
  );
  const effectiveWeekMarkers = useMemo(
    () => (timelineScale === "month" ? uniformizeMarkerWidths(timeline.weekMarkers) : timeline.weekMarkers),
    [timelineScale, timeline.weekMarkers],
  );
  const effectiveMonthMarkers = useMemo(
    () => (timelineScale === "month" ? buildUniformMonthMarkers(effectiveWeekMarkers) : timeline.monthMarkers),
    [timelineScale, timeline.monthMarkers, effectiveWeekMarkers],
  );
  const effectiveTodayPct = useMemo(
    () => (timelineScale === "month" ? recomputeTodayPctUniform(new Date(), effectiveWeekMarkers) : timeline.todayPct),
    [timelineScale, timeline.todayPct, effectiveWeekMarkers],
  );

  const activeFilterCount =
    selectedStateGroups.length +
    selectedMembers.length +
    selectedPriority.length +
    selectedDifficulty.length +
    (selectedProgressMode === "all" ? 0 : 1);
  const appliedFilterCount =
    appliedFilters.stateGroups.length +
    appliedFilters.members.length +
    appliedFilters.priority.length +
    appliedFilters.difficulty.length +
    (appliedFilters.progressMode === "all" ? 0 : 1);
  const defaultDateWindow = getDefaultDateWindow();
  const hasDraftDateChanges =
    dateFrom !== defaultDateWindow.dateFrom || dateTo !== defaultDateWindow.dateTo;
  const hasAppliedDateChanges =
    appliedFilters.dateFrom !== defaultDateWindow.dateFrom ||
    appliedFilters.dateTo !== defaultDateWindow.dateTo;

  const timelineGridDivisions =
    timelineScale === "week"
      ? Math.max(timeline.totalDays, 1)
      : Math.max(effectiveWeekMarkers.length, 1);
  const showDayLabels = timelineScale === "week";
  const timelineGridStyle: CSSProperties = {
    backgroundSize: `${100 / timelineGridDivisions}% 100%`,
    backgroundImage: showDayLabels ? undefined : "none",
  };
  const dateRangeError =
    dateFrom && dateTo && dateFrom > dateTo
      ? "시작일은 종료일보다 늦을 수 없습니다."
      : null;
  const baseTimelineWidth = timelineScale === "week" ? 34 : 14;
  const minTimelineWidth = timelineScale === "week" ? 760 : 520;
  const timelineWidth = Math.max(
    Math.round(minTimelineWidth * timelineZoom),
    Math.round(timeline.days.length * baseTimelineWidth * timelineZoom),
  );
  const frozenRowGridStyle: CSSProperties = {
    gridTemplateColumns: `52px 200px 72px 76px 66px 66px 46px 74px 88px`,
  };
  const scrollRowGridStyle: CSSProperties = {
    gridTemplateColumns: `${timelineWidth}px`,
  };

  const scrollToToday = () => {
    if (!boardScrollerRef.current || effectiveTodayPct === null) {
      return;
    }

    const scroller = boardScrollerRef.current;
    const targetLeft =
      DETAIL_COLUMNS_WIDTH + (timelineWidth * effectiveTodayPct) / 100 - scroller.clientWidth * 0.4;

    scroller.scrollTo({ left: Math.max(targetLeft, 0), behavior: "smooth" });
  };

  const handleExcelDownload = () => {
    if (!wbs || timeline.rows.length === 0) {
      return;
    }

    const exportBuckets = buildExportBucketHeaders(
      timelineScale,
      effectiveWeekMarkers,
      timeline.days,
    );

    const spreadsheetContent = buildSpreadsheetMlContent({
      projectName: wbs.project.name,
      projectCode: wbs.project.identifier,
      exportedAt: formatKoreanFullDate(new Date()),
      rangeLabel: `${appliedFilters.dateFrom || "전체"} ~ ${appliedFilters.dateTo || "전체"}`,
      timelineScale: timelineScale === "month" ? "월 단위" : "주 단위",
      exportBuckets,
      rows: timeline.rows,
    });

    const blob = new Blob([`\uFEFF${spreadsheetContent}`], {
      type: "application/xml;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileDate = formatDateInputValue(new Date());

    link.href = url;
    link.download = `${wbs.project.identifier}-schedule-${fileDate}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    hasAutoScrolledToTodayRef.current = false;
  }, [projectId, appliedFilters]);

  useEffect(() => {
    if (
      hasAutoScrolledToTodayRef.current ||
      loading ||
      error ||
      !wbs ||
      !boardScrollerRef.current ||
      effectiveTodayPct === null
    ) {
      return;
    }

    const scroller = boardScrollerRef.current;
    const targetLeft =
      DETAIL_COLUMNS_WIDTH + (timelineWidth * effectiveTodayPct) / 100 - scroller.clientWidth * 0.4;

    scroller.scrollLeft = Math.max(targetLeft, 0);
    hasAutoScrolledToTodayRef.current = true;
  }, [effectiveTodayPct, error, loading, projectId, timelineWidth, wbs]);

  const stopTimelineDrag = () => {
    dragStateRef.current = null;
    pendingScrollLeftRef.current = null;

    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }

    boardScrollerRef.current?.classList.remove(styles.boardScrollerDragging);
  };

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (!isTimelineDragTarget(event.target, styles)) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add(styles.boardScrollerDragging);
  };

  const handleTimelinePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startClientX;
    pendingScrollLeftRef.current = dragState.startScrollLeft - deltaX * DRAG_SCROLL_SPEED;

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        if (boardScrollerRef.current && pendingScrollLeftRef.current !== null) {
          boardScrollerRef.current.scrollLeft = pendingScrollLeftRef.current;
        }

        dragRafRef.current = null;
      });
    }

    event.preventDefault();
  };

  const handleTimelinePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    stopTimelineDrag();
  };

  const resetFilters = () => {
    const defaults = getDefaultDateWindow();
    setSelectedStateGroups([]);
    setSelectedMembers([]);
    setSelectedPriority([]);
    setSelectedDifficulty([]);
    setSelectedProgressMode("all");
    setDateFrom(defaults.dateFrom);
    setDateTo(defaults.dateTo);
    setAppliedFilters({ ...EMPTY_FILTERS, dateFrom: defaults.dateFrom, dateTo: defaults.dateTo });
  };

  useEffect(() => {
    return () => {
      dragStateRef.current = null;
      pendingScrollLeftRef.current = null;

      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTask(null);
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) {
        return;
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      lastTriggerRef.current?.focus();
    };
  }, [selectedTask]);

  useLayoutEffect(() => {
    frozenRowRefs.current.length = timeline.rows.length;
    scrollRowRefs.current.length = timeline.rows.length;

    if (timeline.rows.length === 0) {
      return;
    }

    const syncRowHeights = () => {
      const frozenHeader = frozenHeaderRef.current;
      const scrollHeader = scrollHeaderRef.current;

      if (frozenHeader && scrollHeader) {
        frozenHeader.style.height = "auto";
        scrollHeader.style.height = "auto";

        const headerHeight = Math.max(frozenHeader.offsetHeight, scrollHeader.offsetHeight);
        frozenHeader.style.height = `${headerHeight}px`;
        scrollHeader.style.height = `${headerHeight}px`;
      }

      const rowCount = Math.max(frozenRowRefs.current.length, scrollRowRefs.current.length);

      for (let index = 0; index < rowCount; index += 1) {
        const frozenRow = frozenRowRefs.current[index];
        const scrollRow = scrollRowRefs.current[index];

        if (!frozenRow || !scrollRow) {
          continue;
        }

        frozenRow.style.height = "auto";
        scrollRow.style.height = "auto";

        const syncedHeight = Math.max(frozenRow.offsetHeight, scrollRow.offsetHeight);
        frozenRow.style.height = `${syncedHeight}px`;
        scrollRow.style.height = `${syncedHeight}px`;
      }
    };

    syncRowHeights();

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncRowHeights);
    });

    if (frozenHeaderRef.current) {
      resizeObserver.observe(frozenHeaderRef.current);
    }
    if (scrollHeaderRef.current) {
      resizeObserver.observe(scrollHeaderRef.current);
    }
    frozenRowRefs.current.forEach((row) => {
      if (row) {
        resizeObserver.observe(row);
      }
    });
    scrollRowRefs.current.forEach((row) => {
      if (row) {
        resizeObserver.observe(row);
      }
    });

    window.addEventListener("resize", syncRowHeights);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncRowHeights);
    };
  }, [timeline.rows, timelineScale, timelineZoom, wbs]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <div className={`${styles.skeleton} ${styles.skeletonBanner}`} />
          <div className={styles.summaryGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={`${styles.skeleton} ${styles.skeletonCard}`} />
            ))}
          </div>
          <div className={`${styles.skeleton} ${styles.skeletonFilters}`} />
          <div className={`${styles.skeleton} ${styles.skeletonBoard}`} />
        </div>
      </div>
    );
  }

  if (error || !wbs) {
    return (
      <div className={styles.page}>
        <Link href={`/projects/${projectId ?? ""}`} className={styles.backLink}>
          ← 평가 페이지로
        </Link>
        <div className={styles.errorBox}>
          <h2 className={styles.errorTitle}>WBS 데이터 오류</h2>
          <p>{error ?? "WBS 데이터를 불러오지 못했습니다."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link href={`/projects/${projectId ?? ""}`} className={styles.backLink}>
        ← 평가 페이지로
      </Link>

      <header className={styles.banner}>
        <div className={styles.bannerMain}>
          <span className={styles.bannerEyebrow}>Executive WBS Report</span>
          <div className={styles.bannerTitleRow}>
            <h1 className={styles.bannerTitle}>{wbs.project.name}</h1>
            <span className={styles.identifier}>{wbs.project.identifier}</span>
          </div>
          <p className={styles.bannerDescription}>
            시작일~종료일 기준으로 프로젝트 업무를 WBS와 Gantt 형식으로 한 번에 볼 수 있는 보고용 화면입니다.
          </p>
        </div>
        <div className={styles.bannerMeta}>
          <span className={styles.metaLabel}>기준일</span>
          <strong className={styles.metaValue}>{formatKoreanFullDate(new Date())}</strong>
          {(appliedFilters.dateFrom || appliedFilters.dateTo) && (
            <span className={styles.metaRange}>
              {appliedFilters.dateFrom || "전체"} ~ {appliedFilters.dateTo || "전체"}
            </span>
          )}
        </div>
      </header>

      <section className={styles.summaryGrid}>
        <article className={`${styles.summaryCard} ${styles.summaryTotal}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>전체 작업</span>
          </div>
          <strong className={styles.summaryValue}>{wbs.summary.total}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryStarted}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>진행중</span>
          </div>
          <strong className={styles.summaryValue}>{wbs.summary.in_progress}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryTodo}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>할 일</span>
          </div>
          <strong className={styles.summaryValue}>{wbs.summary.todo}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryBacklog}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>백로그</span>
          </div>
          <strong className={styles.summaryValue}>{wbs.summary.backlog}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryCompleted}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>완료</span>
          </div>
          <strong className={styles.summaryValue}>{wbs.summary.completed}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryRate}`}>
          <div className={styles.summaryLabelWrap}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>완료율</span>
          </div>
          <strong className={styles.summaryValue}>
            {wbs.summary.completion_rate.toFixed(1)}
            <span className={styles.summaryUnit}>%</span>
          </strong>
          <div className={styles.rateTrack}>
            <div
              className={styles.rateFill}
              style={{ width: `${Math.min(wbs.summary.completion_rate, 100)}%` }}
            />
          </div>
        </article>
      </section>

      <section className={styles.filterSection}>
        <div className={styles.filterHeader}>
          <h2 className={styles.filterTitle}>필터</h2>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>상태</span>
          <div className={styles.filterChips}>
            {wbs.filters.available_state_groups.map((group) => (
              <button
                key={group}
                type="button"
                className={`${styles.filterChip} ${selectedStateGroups.includes(group) ? styles.filterChipActive : ""}`}
                onClick={() => toggleStateGroup(group)}
              >
                {STATE_GROUP_LABELS[group] ?? group}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>진행률</span>
          <div className={styles.filterChips}>
            {(Object.entries(PROGRESS_FILTER_LABELS) as Array<[
              AppliedFilters["progressMode"],
              string,
            ]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`${styles.filterChip} ${selectedProgressMode === mode ? styles.filterChipActive : ""}`}
                onClick={() => setSelectedProgressMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>우선순위</span>
          <div className={styles.filterChips}>
            {wbs.filters.available_priorities.map((priority) => (
              <button
                key={priority}
                type="button"
                className={`${styles.filterChip} ${selectedPriority.includes(priority) ? styles.filterChipActive : ""}`}
                onClick={() => togglePriority(priority)}
              >
                {PRIORITY_LABELS[priority] ?? priority}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>난이도</span>
          <div className={styles.filterChips}>
            {wbs.filters.available_difficulties.map((difficulty) => (
              <button
                key={difficulty}
                type="button"
                className={`${styles.filterChip} ${selectedDifficulty.includes(difficulty) ? styles.filterChipActive : ""}`}
                onClick={() => toggleDifficulty(difficulty)}
              >
                {DIFFICULTY_LABELS[difficulty] ?? difficulty}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>담당자</span>
          <div className={styles.filterChips}>
            {wbs.filters.available_assignees.map((member) => (
              <button
                key={member.id}
                type="button"
                className={`${styles.filterChip} ${selectedMembers.includes(member.id) ? styles.filterChipActive : ""}`}
                onClick={() => toggleMember(member.id)}
              >
                {member.first_name ? `${member.first_name}(${member.display_name})` : member.display_name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>기간</span>
          <div className={styles.dateRow}>
            <label className={styles.dateField}>
              <span className={styles.dateFieldLabel}>시작일</span>
              <input
                type="date"
                className={styles.dateInput}
                aria-label="시작일"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <span className={styles.dateDivider}>~</span>
            <label className={styles.dateField}>
              <span className={styles.dateFieldLabel}>종료일</span>
              <input
                type="date"
                className={styles.dateInput}
                aria-label="종료일"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
          </div>
          {dateRangeError ? <p className={styles.dateError}>{dateRangeError}</p> : null}
        </div>

        <div className={styles.filterActionRow}>
          <button
            type="button"
            className={styles.filterReset}
            onClick={resetFilters}
            disabled={
              activeFilterCount === 0 &&
              appliedFilterCount === 0 &&
              !hasDraftDateChanges &&
              !hasAppliedDateChanges
            }
          >
            초기화
            {activeFilterCount > 0 ? (
              <span className={styles.activeFilterCount}>{activeFilterCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={styles.filterSearchButton}
            onClick={handleApplyFilters}
            disabled={Boolean(dateRangeError)}
          >
            조회
          </button>
        </div>
      </section>

      <section className={styles.boardSection}>
        <div className={styles.boardTitleRow}>
          <div className={styles.boardHeadingGroup}>
            <h2 className={styles.boardTitle}>WBS + Gantt</h2>
            <span className={styles.boardCount}>{wbs.rows.length}건</span>
          </div>
          <div className={styles.timelineToolbar}>
            <span className={styles.toolbarLabel}>
              타임라인 보기 {Math.round(timelineZoom * 100)}% · 드래그 이동
            </span>
            <div className={styles.toolbarSegment}>
              <button
                type="button"
                className={`${styles.toolbarButton} ${timelineScale === "week" ? styles.toolbarButtonActive : ""}`}
                onClick={() => setTimelineScale("week")}
              >
                주 단위
              </button>
              <button
                type="button"
                className={`${styles.toolbarButton} ${timelineScale === "month" ? styles.toolbarButtonActive : ""}`}
                onClick={() => setTimelineScale("month")}
              >
                월 단위
              </button>
            </div>
            <button
              type="button"
              className={styles.toolbarButton}
              onClick={() => setTimelineZoom((previous) => Math.max(previous - 0.2, 0.7))}
            >
              축소
            </button>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={() => setTimelineZoom(0.75)}
              >
                기본
              </button>
            <button
              type="button"
              className={styles.toolbarButton}
              onClick={() => setTimelineZoom((previous) => Math.min(previous + 0.2, 2))}
            >
              확대
            </button>
            <button
              type="button"
              className={`${styles.toolbarButton} ${styles.toolbarButtonPrimary}`}
              onClick={scrollToToday}
            >
              오늘 위치
            </button>
            <button
              type="button"
              className={`${styles.toolbarButton} ${styles.toolbarButtonPrimary}`}
              onClick={handleExcelDownload}
            >
              엑셀 다운로드
            </button>
          </div>
        </div>

        {timeline.rows.length === 0 ? (
          <div className={styles.noResults}>선택한 필터에 해당하는 작업이 없습니다.</div>
        ) : (
          <div className={styles.ganttShell}>
            <div className={styles.frozenPane}>
              <div
                ref={frozenHeaderRef}
                className={`${styles.frozenHeader} ${styles.headerGridRow} ${!showDayLabels ? styles.headerRowCompact : ""}`}
                style={frozenRowGridStyle}
              >
                <div className={`${styles.frozenCell} ${styles.frozenCodeHeader} ${styles.frozenHeaderCell}`}>WBS</div>
                <div className={`${styles.frozenCell} ${styles.frozenTitleHeader} ${styles.frozenHeaderCell}`}>작업명</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>상태</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>담당자</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>시작일</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>종료일</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>기간</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>우선순위</div>
                <div className={`${styles.frozenCell} ${styles.frozenHeaderCell}`}>진행률</div>
              </div>
              <div className={styles.frozenBody}>
                {timeline.rows.map((row, rowIndex) => (
                  <div
                    key={`frozen-${row.key}`}
                    ref={(element) => {
                      frozenRowRefs.current[rowIndex] = element;
                    }}
                    className={`${styles.frozenRow} ${row.kind === "phase" ? styles.phaseRow : styles.taskRow}`}
                    style={
                      row.kind === "phase"
                        ? { ...frozenRowGridStyle, boxShadow: `inset 3px 0 0 ${row.barColor}` }
                        : frozenRowGridStyle
                    }
                  >
                    <div className={`${styles.frozenCell} ${styles.frozenCodeCell}`}>{row.wbsCode}</div>
                    <div className={`${styles.frozenCell} ${styles.frozenTitleCell}`}>
                      {row.kind === "phase" ? (
                        <>
                          <span className={styles.phaseTitle}>{STATE_GROUP_LABELS[row.group] ?? row.group}</span>
                          <span className={styles.phaseTaskCount}>{row.taskCount}건</span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={styles.taskTitleButton}
                          aria-label={`작업 상세 보기: ${row.title}`}
                          onClick={(event) => {
                            lastTriggerRef.current = event.currentTarget;
                            setSelectedTask(row);
                          }}
                        >
                          <span className={styles.taskTitle}>{row.title}</span>
                        </button>
                      )}
                    </div>
                    <div className={`${styles.frozenCell} ${styles.frozenStateCell}`}>
                      <span
                        className={styles.stateGroupBadge}
                        style={{
                          color: row.barColor,
                          borderColor: `${row.barColor}55`,
                          background: `${row.barColor}18`,
                        }}
                      >
                        {STATE_GROUP_LABELS[row.group] ?? row.group}
                      </span>
                    </div>
                    <div className={`${styles.frozenCell} ${styles.frozenOwnerCell}`}>{row.owner}</div>
                    <div className={`${styles.frozenCell} ${styles.frozenDateCell}`}>{formatShortDate(row.start)}</div>
                    <div className={`${styles.frozenCell} ${styles.frozenDateCell}`}>{formatShortDate(row.end)}</div>
                    <div className={`${styles.frozenCell} ${styles.frozenDurationCell}`}>
                      {row.durationDays}<span className={styles.durationUnit}>d</span>
                    </div>
                    <div className={`${styles.frozenCell} ${styles.frozenPriorityCell}`}>
                      {row.kind === "task" ? (
                        <span className={`${styles.priorityBadge} ${getPriorityClassName(row.priority)}`}>
                          {row.priorityLabel}
                        </span>
                      ) : (
                        <span className={styles.phasePriorityDash}>—</span>
                      )}
                    </div>
                    <div className={`${styles.frozenCell} ${styles.frozenProgressCell}`}>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${row.progress}%`, backgroundColor: row.barColor }}
                        />
                      </div>
                      <span className={styles.progressValue}>{row.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              ref={boardScrollerRef}
              className={styles.boardScroller}
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={handleTimelinePointerUp}
              onPointerCancel={stopTimelineDrag}
              onLostPointerCapture={stopTimelineDrag}
            >
              <div className={styles.scrollBoard}>
                <div
                  ref={scrollHeaderRef}
                  className={`${styles.scrollHeader} ${styles.headerGridRow} ${!showDayLabels ? styles.headerRowCompact : ""}`}
                  style={scrollRowGridStyle}
                >
                  <div className={`${styles.headerCell} ${styles.timelineHeaderCell}`}>
                    <div
                      className={`${styles.timelineHeaderStack} ${showDayLabels ? "" : styles.timelineHeaderStackCompact}`}
                    >
                      <div className={styles.monthBandRow}>
                        {effectiveMonthMarkers.map((marker) => (
                          <span
                            key={marker.key}
                            className={styles.monthBand}
                            style={{ left: `${marker.leftPct}%`, width: `${marker.widthPct}%` }}
                          >
                            {marker.label}
                          </span>
                        ))}
                      </div>
                      <div className={styles.weekBandRow}>
                        {effectiveWeekMarkers.map((marker) => (
                          <span
                            key={marker.key}
                            className={styles.weekBand}
                            style={{ left: `${marker.leftPct}%`, width: `${marker.widthPct}%` }}
                          >
                            {showDayLabels ? marker.label : marker.compactLabel ?? marker.label}
                          </span>
                        ))}
                      </div>
                      {showDayLabels ? (
                        <div className={styles.dayRow}>
                          {timeline.days.map((day) => (
                            <span
                              key={day.key}
                              className={`${styles.dayCell} ${day.weekend ? styles.dayWeekend : ""}`}
                              title={formatDateInputValue(day.date)}
                            >
                              {day.label}
                            </span>
                          ))}
                          {effectiveTodayPct !== null ? (
                            <span className={styles.todayLine} style={{ left: `${effectiveTodayPct}%` }} />
                          ) : null}
                        </div>
                      ) : null}
                      {!showDayLabels && effectiveTodayPct !== null ? (
                        <span className={styles.todayLine} style={{ left: `${effectiveTodayPct}%` }} />
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={styles.scrollBody}>
                  {timeline.rows.map((row, rowIndex) => {
                    const effectiveBar =
                      timelineScale === "month"
                        ? snapBarToWeekBuckets(
                            row.start,
                            row.end,
                            effectiveWeekMarkers,
                            row.leftPct,
                            row.widthPct,
                          )
                        : { leftPct: row.leftPct, widthPct: row.widthPct };
                    const barStyle: CSSProperties = {
                      left: `${effectiveBar.leftPct}%`,
                      width: `${effectiveBar.widthPct}%`,
                      backgroundColor: row.barColor,
                    };

                    return (
                      <div
                        key={row.key}
                        ref={(element) => {
                          scrollRowRefs.current[rowIndex] = element;
                        }}
                        className={`${styles.scrollRow} ${row.kind === "phase" ? styles.phaseRow : styles.taskRow}`}
                        style={scrollRowGridStyle}
                      >
                        <div className={styles.timelineCell}>
                          <div className={styles.timelineTrack} style={timelineGridStyle}>
                            {effectiveWeekMarkers.map((marker) => (
                              <span
                                key={marker.key}
                                className={styles.weekDivider}
                                style={{ left: `${marker.leftPct}%` }}
                              />
                            ))}
                            {effectiveTodayPct !== null ? (
                              <span className={styles.todayLine} style={{ left: `${effectiveTodayPct}%` }} />
                            ) : null}
                            <div className={row.kind === "phase" ? styles.phaseBar : styles.taskBar} style={barStyle}>
                              <div className={styles.barFill} style={{ width: `${row.progress}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedTask ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-modal-title"
          className={styles.modalBackdrop}
          onClick={() => setSelectedTask(null)}
        >
          <div
            ref={modalRef}
            className={styles.modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderMeta}>
                <span className={styles.modalWbsCode}>{selectedTask.wbsCode}</span>
                <span
                  className={styles.modalStateGroup}
                  style={{
                    color: selectedTask.barColor,
                    borderColor: `${selectedTask.barColor}55`,
                    background: `${selectedTask.barColor}14`,
                  }}
                >
                  {STATE_GROUP_LABELS[selectedTask.group] ?? selectedTask.group}
                </span>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="모달 닫기"
                autoFocus
                onClick={() => setSelectedTask(null)}
              >
                ✕
              </button>
            </div>

            <h2 id="task-modal-title" className={styles.modalTitle}>
              {selectedTask.title}
            </h2>

            <div className={styles.modalGrid}>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>담당자</span>
                <span className={styles.modalFieldValue}>{selectedTask.owner}</span>
              </div>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>우선순위</span>
                <span className={`${styles.priorityBadge} ${getPriorityClassName(selectedTask.priority)}`}>
                  {selectedTask.priorityLabel}
                </span>
              </div>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>시작일</span>
                <span className={styles.modalFieldValue}>{formatKoreanFullDate(selectedTask.start)}</span>
              </div>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>종료일</span>
                <span className={styles.modalFieldValue}>{formatKoreanFullDate(selectedTask.end)}</span>
              </div>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>기간</span>
                <span className={styles.modalFieldValue}>{selectedTask.durationDays}일</span>
              </div>
              <div className={styles.modalField}>
                <span className={styles.modalFieldLabel}>난이도</span>
                <span className={`${styles.difficultyBadge} ${styles.modalDifficultyValue}`}>
                  {selectedTask.difficultyLabel}
                </span>
              </div>
              {wbs ? (
                <div className={`${styles.modalField} ${styles.modalFieldFull}`}>
                  <span className={styles.modalFieldLabel}>프로젝트</span>
                  <span className={styles.modalFieldValue}>
                    {wbs.project.name}
                    {wbs.project.identifier ? (
                      <span className={styles.modalProjectId}> · {wbs.project.identifier}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {(appliedFilters.dateFrom || appliedFilters.dateTo) ? (
                <div className={`${styles.modalField} ${styles.modalFieldFull}`}>
                  <span className={styles.modalFieldLabel}>조회 기간</span>
                  <span className={styles.modalFieldValue}>
                    {appliedFilters.dateFrom || "전체"} ~ {appliedFilters.dateTo || "전체"}
                  </span>
                </div>
              ) : null}
            </div>

            <div className={styles.modalProgressSection}>
              <div className={styles.modalProgressLabel}>
                <span className={styles.modalProgressText}>진행률</span>
                <span className={styles.modalProgressValue}>{selectedTask.progress}%</span>
              </div>
              <div className={styles.modalProgressTrack}>
                <div
                  className={styles.modalProgressFill}
                  style={{
                    width: `${selectedTask.progress}%`,
                    backgroundColor: selectedTask.barColor,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
