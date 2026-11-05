// MEMBER-API-05 응답의 deadlinePassed·permissions 산정. DB를 읽지 않는 순수 함수다
// 화면 제어용 힌트일 뿐이고, 각 쓰기 API가 잠금 후 권한·상태·마감을 다시 판정한다

export type MePermissions = {
  canEditAvailability: boolean;
  canSubmit: boolean;
  canManagePromise: boolean;
  canLeave: boolean;
};

// 서버 판정 시각 기준 마감 경과 여부. 판정 시각 = 마감이면 지난 것으로 본다 (TIME-15-01, TIME-API-02와 같은 경계)
// 상태가 아직 collecting이어도 true일 수 있다 (TIME-15-04). 마감이 없는 draft는 false
export function isDeadlinePassed(votingDeadlineAt: Date | null, now: Date): boolean {
  return votingDeadlineAt !== null && votingDeadlineAt.getTime() <= now.getTime();
}

// MEMBER-API-05 「permissions 산정 규칙」. 참여자가 cancelled면 모두 false
export function computeMePermissions(input: {
  role: string;
  status: string;
  promiseStatus: string;
  deadlinePassed: boolean;
}): MePermissions {
  const active = input.status === "active";
  const notCancelled = input.promiseStatus !== "cancelled";
  // STATE-06-02: active + collecting + 마감 전
  const canEditAvailability =
    active && input.promiseStatus === "collecting" && !input.deadlinePassed;
  return {
    canEditAvailability,
    canSubmit: canEditAvailability,
    // STATE-10-01
    canManagePromise: input.role === "host" && active && notCancelled,
    // STATE-06-01, MEMBER-12-01·03: 마감 후에도, 방장도 탈퇴 가능
    canLeave: active && notCancelled,
  };
}
