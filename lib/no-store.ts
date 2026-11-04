// 모든 API 응답(성공·에러)은 캐시하지 않는다. 상태·세션·만료가 요청마다 달라지기 때문이다
// Route Handler는 응답을 만드는 처리 함수를 이 함수로 한 번 감싸 분기마다 빠뜨리지 않게 한다
export function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
