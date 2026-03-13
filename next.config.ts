// 자체 호스팅 Plane 서버의 SSL 인증서 체인이 불완전한 경우를 위한 설정
// 내부 네트워크 전용 도구이므로 SSL 검증을 비활성화합니다.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
