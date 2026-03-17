export interface PlaneUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar: string | null;
  avatar_url: string | null;
  display_name: string;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string | null;
  total_members: number;
  total_cycles: number;
  total_modules: number;
  is_member: boolean;
  member_role: number | null;
  network: number | null;
  created_at: string;
  updated_at: string;
  workspace: string;
  project_lead: string | null;
}

export interface PlaneMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar: string | null;
  avatar_url: string | null;
  display_name: string;
  role: number | null;
}

export interface PlaneState {
  id: string;
  name: string;
  color: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  sequence: number;
  is_triage: boolean;
  default: boolean;
}

export interface PlaneWorkItem {
  id: string;
  name: string;
  description_html?: string | null;
  state: string;
  assignees: string[];
  priority: string;
  estimate_point: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  sequence_id?: number;
  start_date?: string | null;
  target_date?: string | null;
  due_date?: string | null;
  parent?: string | { id: string } | null;
  parent_id?: string | null;
}

export interface PlaneEstimatePoint {
  id: string;
  key: number;
  value: string;
  description: string;
  estimate: string;
  project: string;
  workspace: string;
}

type PlaneListResponse<T> =
  | T[]
  | {
      results: T[];
      total_count?: number;
      next_cursor?: string | null;
      next_page_results?: boolean;
      count?: number;
    };

export class PlaneApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PlaneApiError";
    this.status = status;
  }
}

function toAbsolutePlaneUrl(endpoint: string): string {
  const baseUrl = process.env.PLANE_BASE_URL;

  if (!baseUrl) {
    throw new Error("PLANE_BASE_URL is not configured.");
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;

  return new URL(normalizedEndpoint, normalizedBase).toString();
}

function unwrapListResponse<T>(payload: PlaneListResponse<T>): T[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  throw new Error("Unexpected Plane API list response format.");
}

export async function planeFetch<T>(endpoint: string): Promise<T> {
  const apiKey = process.env.PLANE_API_KEY;

  if (!apiKey) {
    throw new Error("PLANE_API_KEY is not configured.");
  }

  const response = await fetch(toAbsolutePlaneUrl(endpoint), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const fallbackMessage = `Plane API request failed with status ${response.status}.`;
    let detail = "";

    try {
      detail = await response.text();
    } catch {
      detail = "";
    }

    const message = detail.trim() ? `${fallbackMessage} ${detail}` : fallbackMessage;
    throw new PlaneApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function getCurrentUser(): Promise<PlaneUser> {
  return planeFetch<PlaneUser>("/api/v1/users/me/");
}

export async function getProjects(workspaceSlug: string): Promise<PlaneProject[]> {
  const response = await planeFetch<PlaneListResponse<PlaneProject>>(
    `/api/v1/workspaces/${workspaceSlug}/projects/`,
  );

  return unwrapListResponse(response);
}

export async function getWorkspaceMembers(
  workspaceSlug: string,
): Promise<PlaneMember[]> {
  const response = await planeFetch<PlaneListResponse<PlaneMember>>(
    `/api/v1/workspaces/${workspaceSlug}/members/`,
  );

  return unwrapListResponse(response);
}

export async function getProjectStates(
  workspaceSlug: string,
  projectId: string,
): Promise<PlaneState[]> {
  const response = await planeFetch<PlaneListResponse<PlaneState>>(
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/states/`,
  );
  return unwrapListResponse(response);
}

export async function getProjectMembers(
  workspaceSlug: string,
  projectId: string,
): Promise<PlaneMember[]> {
  const response = await planeFetch<PlaneListResponse<PlaneMember>>(
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/members/`,
  );
  return unwrapListResponse(response);
}

export async function getProjectWorkItems(
  workspaceSlug: string,
  projectId: string,
): Promise<PlaneWorkItem[]> {
  const response = await planeFetch<PlaneListResponse<PlaneWorkItem>>(
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/`,
  );
  return unwrapListResponse(response);
}

/**
 * 프로젝트의 Estimate Point 정의를 가져옵니다.
 * Plane v1 API에서는 estimate 엔드포인트를 지원하지 않는 경우가 있어,
 * project-estimates → estimates 순서로 시도 후 실패하면 null을 반환합니다.
 */
export async function getProjectEstimatePoints(
  workspaceSlug: string,
  projectId: string,
): Promise<PlaneEstimatePoint[] | null> {
  const endpoints = [
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/project-estimates/`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/estimates/`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await planeFetch<PlaneListResponse<PlaneEstimatePoint>>(endpoint);
      return unwrapListResponse(response);
    } catch (error) {
      if (error instanceof PlaneApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  return null;
}
