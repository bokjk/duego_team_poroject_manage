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
const DEFAULT_DURATION_DAYS = 7;
const DRAG_SCROLL_SPEED = 2.25;
const FROZEN_COLUMNS_WIDTH = 404;
const DETAIL_COLUMNS_WIDTH = 576;
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

function differenceInDays(start: Date, end: Date): number {
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_IN_MS) + 1;
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

function escapeCsvValue(value: string | number): string {
  const raw = String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const normalized = formulaSafe.replaceAll('"', '""');
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function buildCsvContent(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map((cell) => escapeCsvValue(cell)).join(",")).join("\n");
}

function buildExportBucketHeaders(
  timelineScale: "week" | "month",
  weekMarkers: TimelineMarker[],
  days: TimelineDay[],
): Array<{ key: string; label: string; start: Date; end: Date }> {
  if (timelineScale === "month") {
    return weekMarkers.map((marker) => ({
      key: marker.key,
      label: `${marker.start.getMonth() + 1}월 ${marker.compactLabel ?? marker.label}`,
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

function buildMonthMarkers(start: Date, totalDays: number): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const end = addDays(start, totalDays - 1);
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const segmentStart = cursor < start ? start : cursor;
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segmentEnd = addDays(nextMonth, -1) > end ? end : addDays(nextMonth, -1);
    const offset = Math.floor((segmentStart.getTime() - start.getTime()) / DAY_IN_MS);
    const width = differenceInDays(segmentStart, segmentEnd);

    markers.push({
      key: `month-${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: `${segmentStart.getFullYear()}년 ${segmentStart.getMonth() + 1}월`,
      start: segmentStart,
      end: segmentEnd,
      leftPct: (offset / totalDays) * 100,
      widthPct: (width / totalDays) * 100,
    });

    cursor = nextMonth;
  }

  return markers;
}

function buildWeekMarkers(start: Date, totalDays: number): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const end = addDays(start, totalDays - 1);
  let cursor = start;
  let weekIndexInMonth = 1;

  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const segmentEndCandidate = addDays(cursor, 6);
    const segmentEnd = [segmentEndCandidate, monthEnd, end].reduce((currentMin, candidate) =>
      candidate < currentMin ? candidate : currentMin,
    );
    const offset = Math.floor((cursor.getTime() - start.getTime()) / DAY_IN_MS);
    const width = differenceInDays(cursor, segmentEnd);

    markers.push({
      key: `week-${cursor.getFullYear()}-${cursor.getMonth()}-${weekIndexInMonth}`,
      label:
        cursor.getMonth() === segmentEnd.getMonth()
          ? `${cursor.getMonth() + 1}/${cursor.getDate()}-${segmentEnd.getDate()}`
          : `${cursor.getMonth() + 1}/${cursor.getDate()}-${segmentEnd.getMonth() + 1}/${segmentEnd.getDate()}`,
      compactLabel: `${weekIndexInMonth}주`,
      start: cursor,
      end: segmentEnd,
      leftPct: (offset / totalDays) * 100,
      widthPct: (width / totalDays) * 100,
    });

    const nextCursor = addDays(segmentEnd, 1);
    weekIndexInMonth = nextCursor.getMonth() === cursor.getMonth() ? weekIndexInMonth + 1 : 1;
    cursor = nextCursor;
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
      const start = startOfDay(
        parseDateValue(row.start_date) ?? parseDateValue(row.created_at) ?? today,
      );
      const dueCandidate =
        parseDateValue(row.target_date) ??
        parseDateValue(row.due_date) ??
        parseDateValue(row.completed_at);
      const end = startOfDay(dueCandidate ?? addDays(start, DEFAULT_DURATION_DAYS - 1));
      const safeEnd = end < start ? start : end;

      taskRows.push({
        kind: "task",
        key: row.id,
        group: entry.group,
        wbsCode: hasHierarchy ? (codes.get(row.id) ?? `${phaseCode}.${taskIndex + 1}`) : `${phaseCode}.${taskIndex + 1}`,
        title: row.name,
        owner: getAssigneeLabel(row.assignees),
        start,
        end: safeEnd,
        durationDays: differenceInDays(start, safeEnd),
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
    : addDays(today, 13);

  const timelineStart = addDays(startOfDay(minDate), -1);
  const timelineEnd = addDays(startOfDay(maxDate), 1);
  const totalDays = Math.max(differenceInDays(timelineStart, timelineEnd), 1);

  const toLeftPct = (date: Date) => {
    const offset = Math.floor((startOfDay(date).getTime() - timelineStart.getTime()) / DAY_IN_MS);
    return clamp((offset / totalDays) * 100, 0, 100);
  };

  const toWidthPct = (start: Date, end: Date) => {
    const widthDays = Math.max(differenceInDays(start, end), 1);
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
      durationDays: differenceInDays(phaseStart, phaseEnd),
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

  const days = Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(timelineStart, index);

    return {
      key: `day-${formatDateInputValue(date)}`,
      date,
      label: DAY_LABELS[date.getDay()],
      weekend: date.getDay() === 0 || date.getDay() === 6,
    };
  });

  const monthMarkers = buildMonthMarkers(timelineStart, totalDays);
  const weekMarkers = buildWeekMarkers(timelineStart, totalDays);

  const todayPct = today >= timelineStart && today <= timelineEnd
    ? clamp((Math.floor((today.getTime() - timelineStart.getTime()) / DAY_IN_MS) / totalDays) * 100, 0, 100)
    : null;

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
      : Math.max(timeline.weekMarkers.length, 1);
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
    gridTemplateColumns: `84px ${FROZEN_COLUMNS_WIDTH - 84}px`,
  };
  const scrollRowGridStyle: CSSProperties = {
    gridTemplateColumns: `140px 92px 92px 82px 170px ${timelineWidth}px`,
  };

  const scrollToToday = () => {
    if (!boardScrollerRef.current || timeline.todayPct === null) {
      return;
    }

    const scroller = boardScrollerRef.current;
    const targetLeft =
      DETAIL_COLUMNS_WIDTH + (timelineWidth * timeline.todayPct) / 100 - scroller.clientWidth * 0.4;

    scroller.scrollTo({ left: Math.max(targetLeft, 0), behavior: "smooth" });
  };

  const handleExcelDownload = () => {
    if (!wbs || timeline.rows.length === 0) {
      return;
    }

    const exportBuckets = buildExportBucketHeaders(
      timelineScale,
      timeline.weekMarkers,
      timeline.days,
    );

    const rows: Array<Array<string | number>> = [
      ["프로젝트명", wbs.project.name],
      ["프로젝트 코드", wbs.project.identifier],
      ["내보낸 시각", formatKoreanFullDate(new Date())],
      ["조회 기간", `${appliedFilters.dateFrom || "전체"} ~ ${appliedFilters.dateTo || "전체"}`],
      ["타임라인 보기", timelineScale === "month" ? "월 단위" : "주 단위"],
      [],
      [
        "WBS",
        "구분",
        "상태 그룹",
        "작업명",
        "담당자",
        "시작일",
        "종료일",
        "기간(일)",
        "진행률(%)",
        "우선순위",
        "난이도",
        ...exportBuckets.map((bucket) => `간트 ${bucket.label}`),
      ],
    ];

    for (const row of timeline.rows) {
      const ganttCells = exportBuckets.map((bucket) =>
        doesRangeOverlap(row.start, row.end, bucket.start, bucket.end) ? "■" : "",
      );

      rows.push([
        row.wbsCode,
        row.kind === "phase" ? "상태 그룹" : "작업",
        STATE_GROUP_LABELS[row.group] ?? row.group,
        row.title,
        row.owner,
        formatDateForExport(row.start),
        formatDateForExport(row.end),
        row.durationDays,
        row.progress,
        row.kind === "task" ? row.priorityLabel : "",
        row.kind === "task" ? row.difficultyLabel : "",
        ...ganttCells,
      ]);
    }

    const csvContent = buildCsvContent(rows);
    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileDate = formatDateInputValue(new Date());

    link.href = url;
    link.download = `${wbs.project.identifier}-wbs-${fileDate}.csv`;
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
      timeline.todayPct === null
    ) {
      return;
    }

    const scroller = boardScrollerRef.current;
    const targetLeft =
      DETAIL_COLUMNS_WIDTH + (timelineWidth * timeline.todayPct) / 100 - scroller.clientWidth * 0.4;

    scroller.scrollLeft = Math.max(targetLeft, 0);
    hasAutoScrolledToTodayRef.current = true;
  }, [error, loading, projectId, timeline.todayPct, timelineWidth, wbs]);

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
                <div className={`${styles.headerCell} ${styles.frozenCodeHeader}`}>WBS</div>
                <div className={`${styles.headerCell} ${styles.frozenTitleHeader}`}>작업명</div>
              </div>
              <div className={styles.frozenBody}>
                {timeline.rows.map((row, rowIndex) => (
                  <div
                    key={`frozen-${row.key}`}
                    ref={(element) => {
                      frozenRowRefs.current[rowIndex] = element;
                    }}
                    className={`${styles.frozenRow} ${row.kind === "phase" ? styles.phaseRow : styles.taskRow}`}
                    style={frozenRowGridStyle}
                  >
                    <div className={`${styles.frozenCell} ${styles.frozenCodeCell}`}>{row.wbsCode}</div>
                    <div className={`${styles.frozenCell} ${styles.frozenTitleCell}`}>
                      <span className={row.kind === "phase" ? styles.phaseTitle : styles.taskTitle}>
                        {row.title}
                      </span>
                      {row.kind === "phase" ? (
                        <span className={styles.phaseTaskCount}>{row.taskCount}건</span>
                      ) : null}
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
                  <div className={styles.headerCell}>담당자</div>
                  <div className={styles.headerCell}>시작일</div>
                  <div className={styles.headerCell}>종료일</div>
                  <div className={styles.headerCell}>기간</div>
                  <div className={styles.headerCell}>진행률</div>
                  <div className={`${styles.headerCell} ${styles.timelineHeaderCell}`}>
                    <div
                      className={`${styles.timelineHeaderStack} ${showDayLabels ? "" : styles.timelineHeaderStackCompact}`}
                    >
                      <div className={styles.monthBandRow}>
                        {timeline.monthMarkers.map((marker) => (
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
                        {timeline.weekMarkers.map((marker) => (
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
                          {timeline.todayPct !== null ? (
                            <span className={styles.todayLine} style={{ left: `${timeline.todayPct}%` }} />
                          ) : null}
                        </div>
                      ) : null}
                      {!showDayLabels && timeline.todayPct !== null ? (
                        <span className={styles.todayLine} style={{ left: `${timeline.todayPct}%` }} />
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
                            timeline.weekMarkers,
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
                        <div className={`${styles.cell} ${styles.cellOwner}`}>{row.owner}</div>
                        <div className={`${styles.cell} ${styles.cellDate}`}>{formatShortDate(row.start)}</div>
                        <div className={`${styles.cell} ${styles.cellDate}`}>{formatShortDate(row.end)}</div>
                        <div className={`${styles.cell} ${styles.cellDuration}`}>{row.durationDays}일</div>
                        <div className={`${styles.cell} ${styles.cellProgress}`}>
                          <div className={styles.progressMeta}>
                            <div className={styles.progressTrack}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${row.progress}%`, backgroundColor: row.barColor }}
                              />
                            </div>
                            <span className={styles.progressValue}>{row.progress}%</span>
                          </div>
                          {row.kind === "task" ? (
                            <div className={styles.progressBadges}>
                              <span className={`${styles.priorityBadge} ${getPriorityClassName(row.priority)}`}>
                                {row.priorityLabel}
                              </span>
                              <span className={styles.difficultyBadge}>{row.difficultyLabel}</span>
                            </div>
                          ) : null}
                        </div>
                        <div className={styles.timelineCell}>
                          <div className={styles.timelineTrack} style={timelineGridStyle}>
                            {timeline.weekMarkers.map((marker) => (
                              <span
                                key={marker.key}
                                className={styles.weekDivider}
                                style={{ left: `${marker.leftPct}%` }}
                              />
                            ))}
                            {timeline.todayPct !== null ? (
                              <span className={styles.todayLine} style={{ left: `${timeline.todayPct}%` }} />
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
    </div>
  );
}
