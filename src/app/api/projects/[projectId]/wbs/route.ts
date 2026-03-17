import { NextResponse } from "next/server";

import {
  PlaneApiError,
  type PlaneMember,
  type PlaneState,
  type PlaneEstimatePoint,
  type PlaneWorkItem,
  getProjectMembers,
  getProjectStates,
  getProjectWorkItems,
  getProjectEstimatePoints,
  getProjects,
} from "@/lib/plane-api";
import { parseProgressMarker } from "@/lib/parse-progress-marker";

const LABEL_WEIGHT: Record<string, number> = { 하: 1, 중: 3, 상: 5 };
const DEFAULT_WEIGHT = 1;
const DEFAULT_LABEL = "하";
const DEFAULT_DURATION_WORK_DAYS = 5;

const FALLBACK_ESTIMATE_MAPPING: Record<string, string> = {
  "112f7d57-3364-4ae3-b57c-228c202b89e2": "난이도:하",
  "321e1754-45df-4c06-b5c9-3bd4847a7298": "난이도:중",
  "5ed85e18-f712-4e6b-9747-50bd541a3d8a": "난이도:상",
};

type DifficultyMapping = Map<string, { label: string; weight: number }>;
const DAY_IN_MS = 1000 * 60 * 60 * 24;

function parseDifficultyLabel(raw: string): string {
  const idx = raw.lastIndexOf(":");
  return idx >= 0 ? raw.slice(idx + 1).trim() : raw.trim();
}

function buildDifficultyMapping(points: PlaneEstimatePoint[] | null): DifficultyMapping {
  const map: DifficultyMapping = new Map();
  if (points && points.length > 0) {
    for (const p of points) {
      const label = parseDifficultyLabel(p.value);
      map.set(p.id, { label, weight: LABEL_WEIGHT[label] ?? DEFAULT_WEIGHT });
    }
  } else {
    for (const [uuid, raw] of Object.entries(FALLBACK_ESTIMATE_MAPPING)) {
      const label = parseDifficultyLabel(raw);
      map.set(uuid, { label, weight: LABEL_WEIGHT[label] ?? DEFAULT_WEIGHT });
    }
  }
  return map;
}

function getDifficultyInfo(
  estimatePoint: string | null,
  mapping: DifficultyMapping,
): { label: string; weight: number } {
  if (!estimatePoint) return { label: DEFAULT_LABEL, weight: DEFAULT_WEIGHT };
  return mapping.get(estimatePoint) ?? { label: DEFAULT_LABEL, weight: DEFAULT_WEIGHT };
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

function addBusinessDays(date: Date, amount: number): Date {
  let cursor = startOfDay(date);

  if (amount === 0) {
    while (isWeekend(cursor)) {
      cursor = addDays(cursor, 1);
    }
    return cursor;
  }

  let remaining = Math.abs(amount);
  const direction = amount > 0 ? 1 : -1;

  while (remaining > 0) {
    cursor = addDays(cursor, direction);
    if (!isWeekend(cursor)) {
      remaining -= 1;
    }
  }

  return cursor;
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

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function resolveWorkItemDates(workItem: PlaneWorkItem): { start: Date; end: Date } {
  const createdAt = parseDateValue(workItem.created_at) ?? new Date();
  const rawStart = startOfDay(parseDateValue(workItem.start_date) ?? createdAt);
  const start = moveToNextWorkday(rawStart);
  const rawEnd =
    parseDateValue(workItem.target_date) ??
    parseDateValue(workItem.due_date) ??
    parseDateValue(workItem.completed_at);
  const fallbackEnd = addBusinessDays(start, DEFAULT_DURATION_WORK_DAYS - 1);
  const end = moveToPreviousWorkday(startOfDay(rawEnd ?? fallbackEnd));

  if (end < start) {
    return { start, end: start };
  }

  return { start, end };
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const STATE_GROUP_ORDER: Record<string, number> = {
  started: 0,
  unstarted: 1,
  backlog: 2,
  completed: 3,
  cancelled: 4,
};

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
  progress: number;
};

function getFallbackProgress(stateGroup: string): number {
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

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!workspaceSlug) {
    return NextResponse.json(
      { error: "PLANE_WORKSPACE_SLUG is not configured." },
      { status: 500 },
    );
  }

  const { projectId } = await context.params;
  const searchParams = new URL(request.url).searchParams;

  const filterStateGroups =
    searchParams.get("stateGroups")?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const filterMembers =
    searchParams.get("members")?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const filterPriority =
    searchParams.get("priority")?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const filterDifficulty =
    searchParams.get("difficulty")?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const progressMode = searchParams.get("progressMode") ?? "all";

  const dateFromParam = searchParams.get("dateFrom");
  const dateToParam = searchParams.get("dateTo");
  const filterDateFrom = dateFromParam ? parseDateValue(dateFromParam) : null;
  const filterDateTo = dateToParam ? parseDateValue(dateToParam) : null;

  if (dateFromParam && !filterDateFrom) {
    return NextResponse.json({ error: "잘못된 시작일 형식입니다." }, { status: 400 });
  }

  if (dateToParam && !filterDateTo) {
    return NextResponse.json({ error: "잘못된 종료일 형식입니다." }, { status: 400 });
  }

  if (filterDateFrom && filterDateTo && filterDateFrom > filterDateTo) {
    return NextResponse.json(
      { error: "시작일은 종료일보다 늦을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const [projects, states, members, workItems, estimatePoints] = await Promise.all([
      getProjects(workspaceSlug),
      getProjectStates(workspaceSlug, projectId),
      getProjectMembers(workspaceSlug, projectId),
      getProjectWorkItems(workspaceSlug, projectId),
      getProjectEstimatePoints(workspaceSlug, projectId),
    ]);

    const project = projects.find((item) => item.id === projectId);

    if (!project) {
      return NextResponse.json(
        { error: "프로젝트를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const stateMap = new Map<string, PlaneState>(states.map((s) => [s.id, s]));
    const memberMap = new Map<string, PlaneMember>(members.map((m) => [m.id, m]));
    const difficultyMapping = buildDifficultyMapping(estimatePoints);

    let total = 0;
    let completed = 0;
    let inProgress = 0;
    let todo = 0;
    let backlog = 0;
    const rows: WbsRow[] = [];

    for (const workItem of workItems) {
      const state = stateMap.get(workItem.state);
      const group = state?.group ?? "unstarted";

      if (group === "cancelled") continue;

      if (progressMode === "exclude_completed" && group === "completed") continue;
      if (progressMode === "completed_only" && group !== "completed") continue;

      if (filterStateGroups.length > 0 && !filterStateGroups.includes(group)) continue;
      if (filterPriority.length > 0 && !filterPriority.includes(workItem.priority)) continue;

      const { label: difficultyLabel, weight: difficultyWeight } = getDifficultyInfo(
        workItem.estimate_point,
        difficultyMapping,
      );

      if (filterDifficulty.length > 0 && !filterDifficulty.includes(difficultyLabel)) continue;

      const resolvedDates = resolveWorkItemDates(workItem);

      if (
        filterMembers.length > 0 &&
        !workItem.assignees.some((id) => filterMembers.includes(id))
      ) {
        continue;
      }

      if (filterDateFrom && resolvedDates.end < startOfDay(filterDateFrom)) continue;
      if (filterDateTo && resolvedDates.start > startOfDay(filterDateTo)) continue;

      total += 1;

      switch (group) {
        case "completed":
          completed += 1;
          break;
        case "started":
          inProgress += 1;
          break;
        case "unstarted":
          todo += 1;
          break;
        case "backlog":
          backlog += 1;
          break;
        default:
          todo += 1;
      }

      const assignees: AssigneeInfo[] = workItem.assignees
        .map((id) => {
          const m = memberMap.get(id);
          return m ? { id: m.id, display_name: m.display_name, first_name: m.first_name } : null;
        })
        .filter((a): a is AssigneeInfo => a !== null);

      rows.push({
        id: workItem.id,
        sequence_id: workItem.sequence_id ?? null,
        name: workItem.name,
        state_id: workItem.state,
        state_name: state?.name ?? "",
        state_color: state?.color ?? "#71717a",
        state_group: group,
        assignees,
        priority: workItem.priority,
        difficulty: difficultyLabel,
        difficulty_weight: difficultyWeight,
        start_date: formatDateOnly(resolvedDates.start),
        due_date: formatDateOnly(resolvedDates.end),
        target_date: workItem.target_date ?? workItem.due_date ?? null,
        completed_at: workItem.completed_at,
        created_at: workItem.created_at,
        parent:
          workItem.parent_id ??
          (workItem.parent == null
            ? null
            : typeof workItem.parent === "string"
              ? workItem.parent
              : workItem.parent.id),
        progress: parseProgressMarker(workItem.description_html) ?? getFallbackProgress(group),
      });
    }

    rows.sort((a, b) => {
      const groupDiff =
        (STATE_GROUP_ORDER[a.state_group] ?? 99) - (STATE_GROUP_ORDER[b.state_group] ?? 99);
      if (groupDiff !== 0) return groupDiff;

      const priorityDiff =
        (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
      if (priorityDiff !== 0) return priorityDiff;

      return a.name.localeCompare(b.name);
    });

    const completionRate =
      total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        description: project.description,
      },
      summary: {
        total,
        completed,
        in_progress: inProgress,
        todo,
        backlog,
        cancelled: 0,
        completion_rate: completionRate,
      },
      filters: {
        available_state_groups: ["backlog", "unstarted", "started", "completed"],
        available_priorities: ["none", "low", "medium", "high", "urgent"],
        available_assignees: members.map((m) => ({
          id: m.id,
          display_name: m.display_name,
          first_name: m.first_name,
        })),
        available_difficulties: ["하", "중", "상"],
      },
      rows,
    });
  } catch (error) {
    if (error instanceof PlaneApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "WBS 데이터를 불러오지 못했습니다.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
