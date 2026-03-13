"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import styles from "./page.module.scss";

type EvaluationResponse = {
  project: {
    id: string;
    name: string;
    identifier: string;
  };
  summary: {
    total_items: number;
    completed: number;
    in_progress: number;
    todo: number;
    backlog: number;
    cancelled: number;
    weighted_score: number;
    weighted_total: number;
  };
  members: Array<{
    id: string;
    display_name: string;
    first_name: string | null;
    avatar_url: string | null;
    total: number;
    completed: number;
    in_progress: number;
    todo: number;
    backlog: number;
    cancelled: number;
    completion_rate: number;
    weighted_score: number;
    weighted_total: number;
    weighted_completion_rate: number;
    rank: number;
    score_100: number;
    score_completion: number;
    score_productivity: number;
    score_difficulty: number;
    score_base: number;
    difficulty_breakdown: Array<{
      label: string;
      weight: number;
      total: number;
      completed: number;
    }>;
  }>;
  states: Array<{
    id: string;
    name: string;
    color: string;
    group: string;
    count: number;
  }>;
  filters: {
    available_members: Array<{
      id: string;
      display_name: string;
      first_name: string | null;
    }>;
    available_priorities: string[];
    available_state_groups: string[];
    available_difficulties: string[];
  };
};

type ApiErrorResponse = {
  error?: string;
};

const STATE_GROUP_LABELS: Record<string, string> = {
  backlog: "백로그",
  unstarted: "할 일",
  started: "진행중",
  completed: "완료",
  cancelled: "취소",
};

const PRIORITY_LABELS: Record<string, string> = {
  none: "없음",
  low: "낮음",
  medium: "보통",
  high: "높음",
  urgent: "긴급",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  "하": "하 (1점)",
  "중": "중 (3점)",
  "상": "상 (5점)",
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

function getAvatarLetter(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) {
    return "?";
  }

  return cleaned.charAt(0).toUpperCase();
}

function getProgressClassName(rate: number): string {
  if (rate > 70) {
    return styles.progressHigh;
  }

  if (rate >= 40) {
    return styles.progressMedium;
  }

  return styles.progressLow;
}

function getRankClassName(rank: number, total: number): string {
  if (total <= 1) return "";
  const ratio = rank / total;
  if (ratio <= 0.33) return styles.rankGold;
  if (ratio <= 0.66) return styles.rankSilver;
  return styles.rankBronze;
}

export default function ProjectEvaluationPage() {
  const params = useParams<{ projectId: string | string[] }>();
  const projectId = parseProjectId(params?.projectId);

  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStateGroups, setSelectedStateGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showScoringGuide, setShowScoringGuide] = useState(false);
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(new Set());
  const [selectedDifficulty, setSelectedDifficulty] = useState<string[]>([]);

  useEffect(() => {
    if (!projectId) {
      setError("잘못된 프로젝트 ID입니다.");
      setLoading(false);
      return;
    }

    const searchParams = new URLSearchParams();
    if (selectedStateGroups.length > 0) {
      searchParams.set("stateGroups", selectedStateGroups.join(","));
    }
    if (selectedMembers.length > 0) {
      searchParams.set("members", selectedMembers.join(","));
    }
    if (selectedPriority.length > 0) {
      searchParams.set("priority", selectedPriority.join(","));
    }
    if (selectedDifficulty.length > 0) {
      searchParams.set("difficulty", selectedDifficulty.join(","));
    }
    if (dateFrom) {
      searchParams.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      searchParams.set("dateTo", dateTo);
    }

    const query = searchParams.toString();
    const requestUrl = `/api/projects/${projectId}/evaluation${query ? `?${query}` : ""}`;

    let active = true;
    setLoading(true);

    const fetchEvaluation = async () => {
      try {
        const response = await fetch(requestUrl, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const payload = (await response.json()) as EvaluationResponse;

        if (!active) {
          return;
        }

        setEvaluation(payload);
        setError(null);
      } catch (caughtError) {
        if (!active) {
          return;
        }

        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "프로젝트 평가 데이터를 불러오지 못했습니다.";

        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchEvaluation();

    return () => {
      active = false;
    };
  }, [
    projectId,
    selectedStateGroups,
    selectedMembers,
    selectedPriority,
    selectedDifficulty,
    dateFrom,
    dateTo,
  ]);

  const stateSegments = useMemo(() => {
    if (!evaluation || evaluation.summary.total_items === 0) {
      return [];
    }

    return evaluation.states
      .filter((state) => state.count > 0)
      .map((state) => ({
        ...state,
        width: (state.count / evaluation.summary.total_items) * 100,
      }));
  }, [evaluation]);

  const displayedMembers = useMemo(() => {
    if (!evaluation) return [];
    if (selectedMembers.length === 0) return evaluation.members;
    return evaluation.members.filter((m) => selectedMembers.includes(m.id));
  }, [evaluation, selectedMembers]);

  const maxWeightedScore = useMemo(() => {
    if (!evaluation || evaluation.members.length === 0) return 0;
    return Math.max(...evaluation.members.map((m) => m.weighted_score));
  }, [evaluation]);
  const displayedMemberCount = displayedMembers.length;

  const activeFilterCount =
    selectedStateGroups.length +
    selectedMembers.length +
    selectedPriority.length +
    selectedDifficulty.length +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const toggleSelectedStateGroup = (group: string) => {
    setSelectedStateGroups((previous) =>
      previous.includes(group)
        ? previous.filter((value) => value !== group)
        : [...previous, group],
    );
  };

  const toggleSelectedPriority = (priority: string) => {
    setSelectedPriority((previous) =>
      previous.includes(priority)
        ? previous.filter((value) => value !== priority)
        : [...previous, priority],
    );
  };

  const toggleSelectedDifficulty = (difficulty: string) => {
    setSelectedDifficulty((previous) =>
      previous.includes(difficulty)
        ? previous.filter((value) => value !== difficulty)
        : [...previous, difficulty],
    );
  };

  const toggleSelectedMember = (memberId: string) => {
    setSelectedMembers((previous) =>
      previous.includes(memberId)
        ? previous.filter((value) => value !== memberId)
        : [...previous, memberId],
    );
  };

  const resetFilters = () => {
    setSelectedStateGroups([]);
    setSelectedMembers([]);
    setSelectedPriority([]);
    setSelectedDifficulty([]);
    setDateFrom("");
    setDateTo("");
  };

  if (loading) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.loadingWrap}>
          <div className={styles.skeleton} />
          <div className={styles.summaryGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeleton} />
            ))}
          </div>
          <div className={styles.memberGrid}>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className={styles.skeleton} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className={styles.dashboard}>
        <Link href="/" className={styles.backLink}>
          ← 프로젝트 목록
        </Link>
        <div className={styles.errorBox}>
          <h2 className={styles.errorTitle}>평가 데이터 오류</h2>
          <p>{error ?? "프로젝트 평가 데이터를 불러오지 못했습니다."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <Link href="/" className={styles.backLink}>
        ← 프로젝트 목록
      </Link>

      <header className={styles.projectHeader}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.projectName}>{evaluation.project.name}</h1>
          <span className={styles.identifier}>
            {evaluation.project.identifier}
          </span>
        </div>
        <Link
          href={`/projects/${projectId}/wbs`}
          className={styles.wbsButton}
        >
          WBS 보기
        </Link>
      </header>

      <section className={styles.filterSection}>
        <div className={styles.filterHeader}>
          <h2 className={styles.filterTitle}>필터</h2>
          <button
            type="button"
            className={styles.filterReset}
            onClick={resetFilters}
            disabled={activeFilterCount === 0}
          >
            초기화
            {activeFilterCount > 0 ? (
              <span className={styles.activeFilterCount}>
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>상태</span>
          <div className={styles.filterChips}>
            {evaluation.filters.available_state_groups.map((group) => {
              const isActive = selectedStateGroups.includes(group);

              return (
                <button
                  type="button"
                  key={group}
                  className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
                  onClick={() => toggleSelectedStateGroup(group)}
                >
                  {STATE_GROUP_LABELS[group] ?? group}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>우선순위</span>
          <div className={styles.filterChips}>
            {evaluation.filters.available_priorities.map((priority) => {
              const isActive = selectedPriority.includes(priority);

              return (
                <button
                  type="button"
                  key={priority}
                  className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
                  onClick={() => toggleSelectedPriority(priority)}
                >
                  {PRIORITY_LABELS[priority] ?? priority}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>난이도</span>
          <div className={styles.filterChips}>
            {(evaluation.filters.available_difficulties ?? []).map((difficulty) => {
              const isActive = selectedDifficulty.includes(difficulty);

              return (
                <button
                  type="button"
                  key={difficulty}
                  className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
                  onClick={() => toggleSelectedDifficulty(difficulty)}
                >
                  {DIFFICULTY_LABELS[difficulty] ?? difficulty}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>담당자</span>
          <div className={styles.filterChips}>
            {evaluation.filters.available_members.map((member) => {
              const isActive = selectedMembers.includes(member.id);

              return (
                <button
                  type="button"
                  key={member.id}
                  className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
                  onClick={() => toggleSelectedMember(member.id)}
                >
                  {member.first_name
                    ? `${member.first_name}(${member.display_name})`
                    : member.display_name}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>기간</span>
          <div className={styles.filterDateRow}>
            <div className={styles.filterDateField}>
              <span className={styles.filterDateText}>시작일</span>
              <input
                type="date"
                className={styles.filterDateInput}
                aria-label="시작일"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <span className={styles.filterDateSeparator}>~</span>
            <div className={styles.filterDateField}>
              <span className={styles.filterDateText}>종료일</span>
              <input
                type="date"
                className={styles.filterDateInput}
                aria-label="종료일"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.summaryGrid}>
        <article className={`${styles.summaryCard} ${styles.summaryTotal}`}>
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>전체 작업</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.total_items}
          </strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryCompleted}`}>
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>완료</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.completed}
          </strong>
        </article>
        <article
          className={`${styles.summaryCard} ${styles.summaryInProgress}`}
        >
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>진행중</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.in_progress}
          </strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryTodo}`}>
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>할 일</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.todo}
          </strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryBacklog}`}>
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>백로그</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.backlog}
          </strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryWeighted}`}>
          <div className={styles.summaryLabelWrapper}>
            <span className={styles.summaryDot} />
            <span className={styles.summaryLabel}>가중 점수</span>
          </div>
          <strong className={styles.summaryValue}>
            {evaluation.summary.weighted_score}
            <span className={styles.summaryUnit}>
              /{evaluation.summary.weighted_total}점
            </span>
          </strong>
        </article>
      </section>

      <section className={styles.stateSection}>
        <h2 className={styles.sectionTitle}>상태 분포</h2>
        <div className={styles.stateBar}>
          {stateSegments.map((state) => (
            <div
              key={state.id}
              className={styles.stateBarSegment}
              style={{ width: `${state.width}%`, backgroundColor: state.color }}
              title={`${STATE_GROUP_LABELS[state.group] ?? state.name}: ${state.count}`}
            />
          ))}
        </div>
        <div className={styles.stateBarLegend}>
          {evaluation.states.map((state) => (
            <div key={state.id} className={styles.legendItem}>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: state.color }}
              />
              <span className={styles.legendLabel}>
                {STATE_GROUP_LABELS[state.group] ?? state.name}
              </span>
              <span className={styles.legendCount}>{state.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.scoringGuideSection}>
        <button
          type="button"
          className={styles.scoringGuideToggle}
          onClick={() => setShowScoringGuide((prev) => !prev)}
        >
          <h2 className={styles.sectionTitle}>점수 산출 기준</h2>
          <span className={styles.scoringGuideArrow}>{showScoringGuide ? "▲" : "▼"}</span>
        </button>
        {showScoringGuide && (
          <div className={styles.scoringGuideContent}>
            <div className={styles.formulaMain}>
              <strong>총점 = 기본(25%) + 달성률(20%) + 생산성(45%) + 난이도(10%) = 100점 만점</strong>
            </div>
            <div className={styles.formulaItems}>
              <div className={styles.formulaItem}>
                <div className={styles.formulaItemTitle}>기본 점수 (25점)</div>
                <div className={styles.formulaItemDesc}>전체 점수의 25%</div>
                <div className={styles.formulaItemNote}>이슈가 1건 이상 할당된 멤버에게 부여. 할당 이슈가 없으면 0점.</div>
              </div>
              <div className={styles.formulaItem}>
                <div className={styles.formulaItemTitle}>달성률 (최대 20점)</div>
                <div className={styles.formulaItemDesc}>전체 점수의 20%</div>
                <div className={styles.formulaItemNote}>할당된 이슈 대비 얼마나 완료했는지. 난이도 가중치가 반영됨.</div>
              </div>
              <div className={styles.formulaItem}>
                <div className={styles.formulaItemTitle}>생산성 (최대 45점)</div>
                <div className={styles.formulaItemDesc}>전체 점수의 45% — 가장 큰 비중</div>
                <div className={styles.formulaItemNote}>팀 내에서 얼마나 많은 일을 처리했는지. 팀 최고 성과자 대비 비교.</div>
              </div>
              <div className={styles.formulaItem}>
                <div className={styles.formulaItemTitle}>난이도 (최대 10점)</div>
                <div className={styles.formulaItemDesc}>전체 점수의 10%</div>
                <div className={styles.formulaItemNote}>어려운 이슈를 많이 처리할수록 높은 점수. 난이도: 하=1점, 중=3점, 상=5점.</div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className={styles.sectionTitle}>멤버별 평가</h2>
        {displayedMembers.length === 0 ? (
          <div className={styles.noResults}>
            선택한 필터에 해당하는 데이터가 없습니다.
          </div>
        ) : (
          <div className={styles.memberGrid}>
            {displayedMembers.map((member) => (
              <article key={member.id} className={styles.memberCard}>
                <div className={styles.memberTop}>
                  <div className={styles.memberIdentity}>
                    <div className={styles.avatarWrapper}>
                      <div className={styles.avatar}>
                        {getAvatarLetter(
                          member.first_name || member.display_name,
                        )}
                      </div>
                      {member.rank > 0 && (
                        <span className={`${styles.rankBadge} ${getRankClassName(member.rank, displayedMemberCount)}`}>
                          {member.rank}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className={styles.memberName}>
                        {member.first_name || member.display_name}
                      </div>
                      <div className={styles.memberSub}>
                        {member.display_name}
                      </div>
                    </div>
                  </div>
                  <div className={styles.scoreArea}>
                    <div className={styles.weightedScore}>
                      {member.score_100}
                      <span className={styles.weightedScoreUnit}>점</span>
                    </div>
                    <div className={styles.weightedRate}>
                      {member.weighted_score}/{member.weighted_total}
                    </div>
                  </div>
                </div>

                <div className={styles.progressBarTrack}>
                  <div
                    className={`${styles.progressBarFill} ${getProgressClassName(member.score_100)}`}
                    style={{
                      width: `${Math.min(member.score_100, 100)}%`,
                    }}
                  />
                </div>

                <div className={styles.memberStats}>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>달성률</span>
                    <strong className={styles.statBoxValue}>
                      {member.score_completion}
                    </strong>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>생산성</span>
                    <strong className={styles.statBoxValue}>
                      {member.score_productivity}
                    </strong>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>난이도</span>
                    <strong className={styles.statBoxValue}>
                      {member.score_difficulty}
                    </strong>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>완료</span>
                    <strong className={styles.statBoxValue}>
                      {member.completed}/{member.total}
                    </strong>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>가중 점수</span>
                    <strong className={styles.statBoxValue}>
                      {member.weighted_score}/{member.weighted_total}
                    </strong>
                  </div>
                  <div className={styles.statBox}>
                    <span className={styles.statBoxLabel}>순위</span>
                    <strong className={styles.statBoxValue}>
                      {member.rank}/{displayedMemberCount}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.calcToggle}
                  onClick={() => setExpandedMemberIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(member.id)) { next.delete(member.id); } else { next.add(member.id); }
                    return next;
                  })}
                >
                  {expandedMemberIds.has(member.id) ? "계산식 접기 ▲" : "계산식 보기 ▼"}
                </button>

                {expandedMemberIds.has(member.id) && (() => {
                  const bd = member.difficulty_breakdown ?? [];
                  const completedParts = bd.filter((d) => d.completed > 0).map((d) => `${d.label} ${d.completed}건×${d.weight}`).join(" + ");
                  const totalParts = bd.filter((d) => d.total > 0).map((d) => `${d.label} ${d.total}건×${d.weight}`).join(" + ");
                  const avgWeight = member.completed > 0 ? member.weighted_score / member.completed : 0;
                  const sqrtRatio = maxWeightedScore > 0 ? member.weighted_score / maxWeightedScore : 0;
                  return (
                  <div className={styles.calcDetail}>
                    {/* 난이도 내역 */}
                    <div className={styles.calcBreakdownSection}>
                      <div className={styles.calcBreakdownTitle}>난이도별 이슈 내역</div>
                      <table className={styles.calcTable}>
                        <thead>
                          <tr>
                            <th>난이도</th>
                            <th>가중치</th>
                            <th>할당</th>
                            <th>완료</th>
                            <th>가중합계</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bd.map((d) => (
                            <tr key={d.label}>
                              <td>{d.label}</td>
                              <td>×{d.weight}</td>
                              <td>{d.total}건</td>
                              <td>{d.completed}건</td>
                              <td>{d.completed > 0 ? `${d.completed}×${d.weight}=${d.completed * d.weight}` : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 1. 기본 점수 */}
                    <div className={styles.calcRow}>
                      <span className={styles.calcLabel}>① 기본 점수</span>
                      <span className={styles.calcFormula}>
                        할당 이슈 {member.total > 0 ? "≥ 1건" : "= 0건"} → {member.score_base}점
                      </span>
                      <strong className={styles.calcResult}>{member.score_base}</strong>
                    </div>

                    {/* 2. 달성률 */}
                    <div className={styles.calcRow}>
                      <span className={styles.calcLabel}>② 달성률</span>
                      <span className={styles.calcFormula}>
                        {member.total > 0 ? (
                          <>
                            가중완료({completedParts || "0"}) / 가중총량({totalParts || "0"})
                            <br />
                            = {member.weighted_score}/{member.weighted_total} × 20 = {member.score_completion}
                          </>
                        ) : "할당 이슈 없음 = 0"}
                      </span>
                      <strong className={styles.calcResult}>{member.score_completion}</strong>
                    </div>

                    {/* 3. 생산성 */}
                    <div className={styles.calcRow}>
                      <span className={styles.calcLabel}>③ 생산성</span>
                      <span className={styles.calcFormula}>
                        {member.total > 0 ? (
                          <>
                            √(내 가중점수 {member.weighted_score} / 팀최고 {maxWeightedScore}) × 45
                            <br />
                            = √{sqrtRatio > 0 ? sqrtRatio.toFixed(4) : "0"} × 45 = {member.score_productivity}
                          </>
                        ) : "할당 이슈 없음 = 0"}
                      </span>
                      <strong className={styles.calcResult}>{member.score_productivity}</strong>
                    </div>

                    {/* 4. 난이도 */}
                    <div className={styles.calcRow}>
                      <span className={styles.calcLabel}>④ 난이도</span>
                      <span className={styles.calcFormula}>
                        {member.completed > 0 ? (
                          <>
                            완료평균가중치({completedParts || "0"}) / 완료수 {member.completed}
                            <br />
                            = {avgWeight.toFixed(1)} / 최대가중치 5 × 10 = {member.score_difficulty}
                          </>
                        ) : "완료 이슈 없음 = 0"}
                      </span>
                      <strong className={styles.calcResult}>{member.score_difficulty}</strong>
                    </div>

                    {/* 합계 */}
                    <div className={`${styles.calcRow} ${styles.calcTotal}`}>
                      <span className={styles.calcLabel}>합계</span>
                      <span className={styles.calcFormula}>
                        {member.score_base} + {member.score_completion} + {member.score_productivity} + {member.score_difficulty}
                      </span>
                      <strong className={styles.calcResult}>{member.score_100}</strong>
                    </div>
                  </div>
                  );
                })()}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
