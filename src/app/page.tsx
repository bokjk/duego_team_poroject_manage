"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { PlaneProject, PlaneUser } from "@/lib/plane-api";

import styles from "./page.module.scss";

const WORKSPACE_SLUG = "research-and-development-division";

type ApiErrorResponse = {
  error?: string;
};

function formatDateKorean(dateValue: string): string {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function humanizeWorkspace(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const ROLE_MAP: Record<number, { label: string; className: string }> = {
  5: { label: "게스트", className: "roleGuest" },
  10: { label: "뷰어", className: "roleViewer" },
  15: { label: "멤버", className: "roleMember" },
  20: { label: "관리자", className: "roleAdmin" },
};

function getRoleClassName(role: number | null): string {
  if (role === null) return styles.roleUnknown;
  const entry = ROLE_MAP[role];
  return entry ? styles[entry.className] : styles.roleUnknown;
}

function roleLabel(role: number | null): string {
  if (role === null) return "미참여";
  return ROLE_MAP[role]?.label ?? `역할 ${role}`;
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    if (payload.error) {
      return payload.error;
    }
  } catch {
    return `HTTP ${response.status}`;
  }

  return `HTTP ${response.status}`;
}

export default function Home() {
  const [user, setUser] = useState<PlaneUser | null>(null);
  const [projects, setProjects] = useState<PlaneProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchDashboardData = async () => {
      try {
        const [meResponse, projectsResponse] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/projects", { cache: "no-store" }),
        ]);

        if (!meResponse.ok) {
          throw new Error(await parseApiError(meResponse));
        }

        if (!projectsResponse.ok) {
          throw new Error(await parseApiError(projectsResponse));
        }

        const [mePayload, projectPayload] = (await Promise.all([
          meResponse.json(),
          projectsResponse.json(),
        ])) as [PlaneUser, PlaneProject[]];

        if (!active) {
          return;
        }

        setUser(mePayload);
        setProjects(projectPayload);
        setError(null);
      } catch (caughtError) {
        if (!active) {
          return;
        }

        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "대시보드 데이터를 불러오지 못했습니다.";

        setError(
          `${message} .env.local의 PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG 값을 확인해주세요.`,
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchDashboardData();

    return () => {
      active = false;
    };
  }, []);

  const workspaceName = useMemo(() => humanizeWorkspace(WORKSPACE_SLUG), []);

  if (loading) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.loadingWrap}>
          <div className={styles.skeleton} />
          <div className={styles.projectGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeleton} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.errorBox}>
          <h2 className={styles.errorTitle}>API 연결 오류</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <span className={styles.workspace}>{workspaceName}</span>
        <h1 className={styles.greeting}>안녕하세요, {user?.display_name ?? "팀원"}님</h1>
        <p className={styles.description}>
          Plane 워크스페이스의 프로젝트 현황을 한눈에 확인하고, 멤버 참여 상태를 빠르게
          파악할 수 있습니다.
        </p>
      </section>

      <section className={styles.stats}>
        <article className={styles.statCard}>
          <span className={styles.statLabel}>전체 프로젝트</span>
          <strong className={styles.statValue}>{projects.length}</strong>
        </article>
        <article className={styles.statCard}>
          <span className={styles.statLabel}>내가 참여 중인 프로젝트</span>
          <strong className={styles.statValue}>
            {projects.filter((project) => project.is_member).length}
          </strong>
        </article>
      </section>

      <section>
        <div className={styles.projectsHeader}>
          <h2 className={styles.projectsTitle}>프로젝트 목록</h2>
          <span className={styles.projectsSub}>{workspaceName} 워크스페이스</span>
        </div>

        {projects.length === 0 ? (
          <div className={styles.empty}>등록된 프로젝트가 없습니다.</div>
        ) : (
          <div className={styles.projectGrid}>
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={styles.projectCardLink}
              >
                <article className={styles.projectCard}>
                  <header className={styles.cardTop}>
                    <h3 className={styles.projectName}>{project.name}</h3>
                    <span className={styles.identifier}>{project.identifier}</span>
                  </header>

                  <p className={styles.projectDescription}>
                    {project.description?.trim() || "설명이 등록되지 않은 프로젝트입니다."}
                  </p>

                  <div className={`${styles.roleBadge} ${getRoleClassName(project.member_role)}`}>
                    {roleLabel(project.member_role)}
                  </div>

                  <div className={styles.meta}>
                    <div>
                      <span className={styles.metaLabel}>멤버 수</span>
                      <span className={styles.metaValue}>{project.total_members}명</span>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>생성일</span>
                      <span className={styles.metaValue}>{formatDateKorean(project.created_at)}</span>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>사이클</span>
                      <span className={styles.metaValue}>{project.total_cycles}</span>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>모듈</span>
                      <span className={styles.metaValue}>{project.total_modules}</span>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
