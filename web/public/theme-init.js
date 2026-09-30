// 첫 화면 깜빡임 방지: 저장된 테마를 렌더링 전에 적용 (CSP 때문에 인라인 스크립트 대신 파일)
(function () {
  try {
    var t = localStorage.getItem('used-car:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* 저장소 접근 불가 시 시스템 설정 사용 */ }
})();
