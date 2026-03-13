import { NextResponse } from "next/server";

import {
  PlaneApiError,
  type PlaneMember,
  type PlaneState,
  type PlaneEstimatePoint,
  getProjectMembers,
  getProjectStates,
  getProjectWorkItems,
  getProjectEstimatePoints,
  getProjects,
} from "@/lib/plane-api";

type StateGroup = PlaneState["group"];

/**
 * 난이도 가중치 매핑 (estimate_point UUID → 가중치)
 *
 * Plane Estimate Point 는 UUID 문자열이며, 프로젝트 설정의
 * 추정(Estimate) 카테고리에서 정의됩니다.
 *
 *   난이도:하 → 가중치 1
 *   난이도:중 → 가중치 3
 *   난이도:상 → 가중치 5
 *   미설정   → 가중치 1 (하 기본값)
 *
 * API 에서 estimate point 정의를 가져올 수 없는 경우
 * FALLBACK_ESTIMATE_MAPPING 을 사용합니다.
 *
 * 복합 평가 점수 배점 (총 100점):
 *   기본 점수   = 25점 (25%) — 이슈가 할당된 참여자 최소 보장
 *   달성률     = 20점 (20%) — 내 할당량 대비 완료율
 *   생산성     = 45점 (45%) — 팀 최고 득점자 대비 상대 기여도 (√ 스케일)
 *   난이도     = 10점 (10%) — 완료한 이슈의 평균 난이도
 */

/** 난이도 라벨 → 가중치 */
const LABEL_WEIGHT: Record<string, number> = {
  "하": 1,
  "중": 3,
  "상": 5,
};

const DEFAULT_WEIGHT = 1; // 난이도 미설정 = 하
const DEFAULT_LABEL = "하";
const MAX_WEIGHT = 5;

/**
 * Plane API 에서 estimate point 목록을 가져올 수 없을 때 사용하는 폴백 매핑.
 * key = estimate_point UUID, value = Plane 에서 설정한 라벨 문자열.
 *
 * 이 매핑은 Plane 프로젝트 설정 > 추정(Estimates) 에서 확인할 수 있으며,
 * UUID 는 work-item 의 estimate_point 필드에 저장된 값입니다.
 */
const FALLBACK_ESTIMATE_MAPPING: Record<string, string> = {
  "112f7d57-3364-4ae3-b57c-228c202b89e2": "난이도:하",
  "321e1754-45df-4c06-b5c9-3bd4847a7298": "난이도:중",
  "5ed85e18-f712-4e6b-9747-50bd541a3d8a": "난이도:상",
};

type DifficultyMapping = Map<string, { label: string; weight: number }>;

/**
 * Estimate point 정의에서 UUID → {label, weight} 매핑을 구축합니다.
 * API 응답이 있으면 동적으로 매핑하고, 없으면 폴백 상수를 사용합니다.
 */
function buildDifficultyMapping(
  estimatePoints: PlaneEstimatePoint[] | null,
): DifficultyMapping {
  const mapping: DifficultyMapping = new Map();

  if (estimatePoints && estimatePoints.length > 0) {
    // API 에서 가져온 estimate point 정의 사용
    // value 필드에 "난이도:하", "난이도:중", "난이도:상" 등의 라벨이 저장됨
    for (const point of estimatePoints) {
      const label = parseDifficultyLabel(point.value);
      const weight = LABEL_WEIGHT[label] ?? DEFAULT_WEIGHT;
      mapping.set(point.id, { label, weight });
    }
  } else {
    // API 미지원 시 폴백 매핑 사용
    for (const [uuid, rawLabel] of Object.entries(FALLBACK_ESTIMATE_MAPPING)) {
      const label = parseDifficultyLabel(rawLabel);
      const weight = LABEL_WEIGHT[label] ?? DEFAULT_WEIGHT;
      mapping.set(uuid, { label, weight });
    }
  }

  return mapping;
}

/**
 * "난이도:하" → "하", "난이도:중" → "중", "난이도:상" → "상"
 * 콜론 뒤의 라벨만 추출. 콜론이 없으면 원본 반환.
 */
function parseDifficultyLabel(raw: string): string {
  const colonIdx = raw.lastIndexOf(":");
  if (colonIdx >= 0) {
    return raw.slice(colonIdx + 1).trim();
  }
  return raw.trim();
}

function getDifficultyWeight(
  estimatePoint: string | null,
  mapping: DifficultyMapping,
): number {
  if (!estimatePoint) return DEFAULT_WEIGHT;
  return mapping.get(estimatePoint)?.weight ?? DEFAULT_WEIGHT;
}

function getDifficultyLabel(
  estimatePoint: string | null,
  mapping: DifficultyMapping,
): string {
  if (!estimatePoint) return DEFAULT_LABEL;
  return mapping.get(estimatePoint)?.label ?? DEFAULT_LABEL;
}

type DifficultyBreakdownItem = {
  label: string;
  weight: number;
  total: number;
  completed: number;
};

type MemberCounters = {
  total: number;
  completed: number;
  in_progress: number;
  todo: number;
  backlog: number;
  cancelled: number;
  weighted_score: number;
  weighted_total: number;
  difficulty_counts: Map<string, { total: number; completed: number }>;
};

type MemberAggregate = {
  id: string;
  display_name: string;
  first_name: string | null;
  avatar_url: string | null;
} & MemberCounters;

type SummaryCounters = {
  total_items: number;
  completed: number;
  in_progress: number;
  todo: number;
  backlog: number;
  cancelled: number;
  weighted_score: number;
  weighted_total: number;
};

function createMemberCounters(): MemberCounters {
  return {
    total: 0,
    completed: 0,
    in_progress: 0,
    todo: 0,
    backlog: 0,
    cancelled: 0,
    weighted_score: 0,
    weighted_total: 0,
    difficulty_counts: new Map(),
  };
}

function incrementCounters(
  counters: MemberCounters,
  group: StateGroup,
  weight: number,
  difficultyLabel: string,
): void {
  counters.total += 1;
  counters.weighted_total += weight;

  // 난이도별 카운트 추적
  const dc = counters.difficulty_counts.get(difficultyLabel) ?? { total: 0, completed: 0 };
  dc.total += 1;

  switch (group) {
    case "completed":
      counters.completed += 1;
      counters.weighted_score += weight;
      dc.completed += 1;
      break;
    case "started":
      counters.in_progress += 1;
      break;
    case "unstarted":
      counters.todo += 1;
      break;
    case "backlog":
      counters.backlog += 1;
      break;
    case "cancelled":
      counters.cancelled += 1;
      break;
    default:
      counters.todo += 1;
      break;
  }

  counters.difficulty_counts.set(difficultyLabel, dc);
}

function incrementSummary(
  summary: SummaryCounters,
  group: StateGroup,
  weight: number,
): void {
  summary.total_items += 1;
  summary.weighted_total += weight;

  switch (group) {
    case "completed":
      summary.completed += 1;
      summary.weighted_score += weight;
      break;
    case "started":
      summary.in_progress += 1;
      break;
    case "unstarted":
      summary.todo += 1;
      break;
    case "backlog":
      summary.backlog += 1;
      break;
    case "cancelled":
      summary.cancelled += 1;
      break;
    default:
      summary.todo += 1;
      break;
  }
}

function toCompletionRate(completed: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round((completed / total) * 1000) / 10;
}

function getStateGroup(stateMap: Map<string, PlaneState>, stateId: string): StateGroup {
  return stateMap.get(stateId)?.group ?? "unstarted";
}

function toMemberAggregate(member: PlaneMember): MemberAggregate {
  return {
    id: member.id,
    display_name: member.display_name,
    first_name: member.first_name,
    avatar_url: member.avatar_url,
    ...createMemberCounters(),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!workspaceSlug) {
    return NextResponse.json(
      { error: "PLANE_WORKSPACE_SLUG is not configured." },
      {
        status: 500,
      },
    );
  }

  const { projectId } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const filterStateGroups =
    searchParams
      .get("stateGroups")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const filterMembers =
    searchParams
      .get("members")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const filterPriority =
    searchParams
      .get("priority")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const filterDifficulty =
    searchParams
      .get("difficulty")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];

  const dateFromParam = searchParams.get("dateFrom");
  const dateToParam = searchParams.get("dateTo");

  const filterDateFrom = dateFromParam ? new Date(dateFromParam) : null;
  const filterDateTo = dateToParam ? new Date(dateToParam) : null;

  if (filterDateFrom && Number.isNaN(filterDateFrom.getTime())) {
    return NextResponse.json({ error: "잘못된 시작일 형식입니다." }, { status: 400 });
  }

  if (filterDateTo && Number.isNaN(filterDateTo.getTime())) {
    return NextResponse.json({ error: "잘못된 종료일 형식입니다." }, { status: 400 });
  }

  if (filterDateTo && dateToParam && dateToParam.length === 10) {
    filterDateTo.setHours(23, 59, 59, 999);
  }

  try {
    const [projects, states, members, workItems, estimatePoints] = await Promise.all([
      getProjects(workspaceSlug),
      getProjectStates(workspaceSlug, projectId),
      getProjectMembers(workspaceSlug, projectId),
      getProjectWorkItems(workspaceSlug, projectId),
      getProjectEstimatePoints(workspaceSlug, projectId),
    ]);

    const difficultyMapping = buildDifficultyMapping(estimatePoints);

    const project = projects.find((item) => item.id === projectId);

    if (!project) {
      return NextResponse.json(
        { error: "프로젝트를 찾을 수 없습니다." },
        {
          status: 404,
        },
      );
    }

    const stateMap = new Map(states.map((state) => [state.id, state]));
    const memberMap = new Map(members.map((member) => [member.id, toMemberAggregate(member)]));
    const stateCounts = new Map<string, number>();

    const summary: SummaryCounters = {
      total_items: 0,
      completed: 0,
      in_progress: 0,
      todo: 0,
      backlog: 0,
      cancelled: 0,
      weighted_score: 0,
      weighted_total: 0,
    };

    const unassignedAggregate: MemberAggregate = {
      id: "unassigned",
      display_name: "미할당",
      first_name: null,
      avatar_url: null,
      ...createMemberCounters(),
    };

    for (const workItem of workItems) {
      const group = getStateGroup(stateMap, workItem.state);
      const createdAt = new Date(workItem.created_at);
      const weight = getDifficultyWeight(workItem.estimate_point, difficultyMapping);

      if (filterStateGroups.length > 0 && !filterStateGroups.includes(group)) continue;
      if (filterPriority.length > 0 && !filterPriority.includes(workItem.priority)) continue;
      const difficultyLabel = getDifficultyLabel(workItem.estimate_point, difficultyMapping);
      if (filterDifficulty.length > 0 && !filterDifficulty.includes(difficultyLabel)) continue;
      if (
        filterMembers.length > 0 &&
        !workItem.assignees.some((assigneeId) => filterMembers.includes(assigneeId))
      ) {
        continue;
      }
      if (!Number.isNaN(createdAt.getTime())) {
        if (filterDateFrom && createdAt < filterDateFrom) continue;
        if (filterDateTo && createdAt > filterDateTo) continue;
      }

      incrementSummary(summary, group, weight);
      stateCounts.set(workItem.state, (stateCounts.get(workItem.state) ?? 0) + 1);

      if (workItem.assignees.length === 0) {
        incrementCounters(unassignedAggregate, group, weight, difficultyLabel);
        continue;
      }

      for (const assigneeId of workItem.assignees) {
        const memberAggregate =
          memberMap.get(assigneeId) ??
          {
            id: assigneeId,
            display_name: "알 수 없는 멤버",
            first_name: null,
            avatar_url: null,
            ...createMemberCounters(),
          };

        incrementCounters(memberAggregate, group, weight, difficultyLabel);
        memberMap.set(assigneeId, memberAggregate);
      }
    }

    const maxWeight = MAX_WEIGHT;

    const memberRows = Array.from(memberMap.values())
      .map((member) => {
        const hasWork = member.total > 0;
        const baseScore = hasWork ? 25 : 0;

        const completionScore = hasWork
          ? (member.weighted_score / member.weighted_total) * 20
          : 0;

        const avgCompletedWeight =
          member.completed > 0
            ? member.weighted_score / member.completed
            : 0;

        const difficultyScore = hasWork
          ? (avgCompletedWeight / maxWeight) * 10
          : 0;

        // 난이도별 내역 직렬화
        const difficultyBreakdown: DifficultyBreakdownItem[] = ["\ud558", "\uc911", "\uc0c1"].map((label) => {
          const counts = member.difficulty_counts.get(label) ?? { total: 0, completed: 0 };
          return {
            label,
            weight: LABEL_WEIGHT[label] ?? DEFAULT_WEIGHT,
            total: counts.total,
            completed: counts.completed,
          };
        });

        return {
          id: member.id,
          display_name: member.display_name,
          first_name: member.first_name,
          avatar_url: member.avatar_url,
          total: member.total,
          completed: member.completed,
          in_progress: member.in_progress,
          todo: member.todo,
          backlog: member.backlog,
          cancelled: member.cancelled,
          completion_rate: toCompletionRate(member.completed, member.total),
          weighted_score: member.weighted_score,
          weighted_total: member.weighted_total,
          weighted_completion_rate: toCompletionRate(member.weighted_score, member.weighted_total),
          rank: 0,
          score_100: 0,
          score_completion: Math.round(completionScore * 10) / 10,
          score_productivity: 0,
          score_difficulty: Math.round(difficultyScore * 10) / 10,
          score_base: baseScore,
          difficulty_breakdown: difficultyBreakdown,
        };
      })
      .sort((left, right) => right.weighted_score - left.weighted_score || left.display_name.localeCompare(right.display_name));

    // 미할당 이슈는 점수 집계에서 제외

    // 순위 계산: 가중 총점 기준 내림차순, 동점이면 같은 순위
    let currentRank = 1;
    for (let i = 0; i < memberRows.length; i++) {
      if (i > 0 && memberRows[i].weighted_score < memberRows[i - 1].weighted_score) {
        currentRank = i + 1;
      }
      memberRows[i].rank = currentRank;
    }

    // 복합 점수 계산: 기본(25) + 달성률(20) + 생산성(45√) + 난이도(10)
    const maxMemberWeightedScore = memberRows.length > 0 ? memberRows[0].weighted_score : 0;
    for (const row of memberRows) {
      const productivityScore =
        maxMemberWeightedScore > 0 && row.total > 0
          ? Math.sqrt(row.weighted_score / maxMemberWeightedScore) * 45
          : 0;
      row.score_productivity = Math.round(productivityScore * 10) / 10;
      row.score_100 = Math.round((row.score_base + row.score_completion + row.score_productivity + row.score_difficulty) * 10) / 10;
    }

    // score_100 기준으로 재정렬
    memberRows.sort((left, right) => right.score_100 - left.score_100 || left.display_name.localeCompare(right.display_name));

    // 재정렬 후 순위 재계산
    currentRank = 1;
    for (let i = 0; i < memberRows.length; i++) {
      if (i > 0 && memberRows[i].score_100 < memberRows[i - 1].score_100) {
        currentRank = i + 1;
      }
      memberRows[i].rank = currentRank;
    }

    const stateRows = [...states]
      .sort((left, right) => left.sequence - right.sequence)
      .map((state) => ({
        id: state.id,
        name: state.name,
        color: state.color,
        group: state.group,
        count: stateCounts.get(state.id) ?? 0,
      }));

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        identifier: project.identifier,
      },
      summary,
      members: memberRows,
      states: stateRows,
      filters: {
        available_members: members.map((member) => ({
          id: member.id,
          display_name: member.display_name,
          first_name: member.first_name,
        })),
        available_priorities: ["none", "low", "medium", "high", "urgent"],
        available_state_groups: ["backlog", "unstarted", "started", "completed", "cancelled"],
        available_difficulties: ["하", "중", "상"],
      },
    });
  } catch (error) {
    if (error instanceof PlaneApiError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
        },
      );
    }

    const message = error instanceof Error ? error.message : "프로젝트 평가 데이터를 불러오지 못했습니다.";

    return NextResponse.json(
      { error: message },
      {
        status: 500,
      },
    );
  }
}
