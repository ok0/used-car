import type { CompareResponse } from '../../../../src/server/api-types';
import type { InputOptionItem } from '../../../../src/types';
import { PLATFORM_LABEL } from '../../lib/labels';
import { fmtManwon, fmtPct } from '../../lib/format';
import { HBar } from '../../components/Bar';
import { Chip } from '../../components/Badge';

function matchedNamesText(pkgName: string, names: readonly string[]): string {
  if (names.length === 0 || (names.length === 1 && names[0] === pkgName)) return '';
  return `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''}`;
}

function ItemGroup({ title, items, tone }: { title: string; items: InputOptionItem[]; tone?: 'good' | 'warn' | 'unknown' }) {
  if (items.length === 0) return null;
  return (
    <div className="opt-group">
      <h4>{title} <span className="muted">{items.length}</span></h4>
      <div className="chips">{items.map((x) => <Chip key={x.name} tone={tone}>{x.availability === 'default' ? `${x.name} [기본]` : x.name}</Chip>)}</div>
    </div>
  );
}

export function OptionSection({ r }: { r: CompareResponse }) {
  const op = r.result.option;
  const pp = op.packagePeers;
  const items = op.items;
  return (
    <section className="card">
      <h2 className="card-title">옵션 상세</h2>
      {items === null ? <p className="muted">옵션 목록: 정보 미제공</p> : (
        <>
          <ItemGroup title="장착" items={items.filter((x) => x.choice === 'loaded')} tone="good" />
          <ItemGroup title="사제 장착" items={items.filter((x) => x.choice === 'loaded_aftermarket')} tone="warn" />
          <ItemGroup title="미장착" items={items.filter((x) => x.choice === 'absent')} />
          <ItemGroup title="상태 미상" items={items.filter((x) => x.choice === 'unknown')} tone="unknown" />
        </>
      )}
      <h3 className="card-subtitle">출고 선택옵션</h3>
      {op.packages === null ? <p className="muted">정보 미제공</p>
        : op.packages.length === 0 ? <p className="muted">없음 ({PLATFORM_LABEL[r.input.platform]} 출고 정보 기준)</p> : (
          <>
            {pp !== null && pp.items !== null && (
              <p className="muted small">
                동급 장착 비율: {pp.knownCount < pp.poolCount ? `트림 동급 ${pp.poolCount}대 중 옵션 이름이 확인된 ${pp.knownCount}대` : `트림 동급 ${pp.knownCount}대`} 기준, 연식 ±{r.result.criteria.yearRange}년·주행거리 무관, 점수 미반영
              </p>
            )}
            {pp !== null && pp.items === null && (
              <p className="muted small">동급 동일 선택옵션 장착 비율: 옵션 이름이 확인된 동급이 {pp.knownCount}대(트림 동급 {pp.poolCount}대 중)로 부족해 생략 — 엔카 옵션 재수집 후 표시</p>
            )}
            <table className="table compact">
              <thead><tr><th>옵션</th><th className="num">가격</th>{pp?.items && <th style={{ width: '32%' }}>동급 장착 비율</th>}{pp?.items && <th>엔카 표기</th>}</tr></thead>
              <tbody>
                {op.packages.map((p) => {
                  const it = pp?.items?.find((x) => x.name === p.name) ?? null;
                  return (
                    <tr key={p.name}>
                      <td>{p.name}{p.items.length > 0 && <div className="muted small">{p.items.join(', ')}</div>}</td>
                      <td className="num">{p.price === null ? '-' : fmtManwon(p.price)}</td>
                      {pp?.items && <td>{it === null ? '-' : it.withCount === 0 ? <span className="muted small">같은 이름의 옵션을 가진 동급 없음 (엔카 표기 차이일 수 있음)</span>
                        : <HBar value={it.withCount} max={pp.knownCount} text={`${it.withCount}/${pp.knownCount}대 (${fmtPct(it.withCount / pp.knownCount)})`} />}</td>}
                      {pp?.items && <td className="small">{it === null ? '' : matchedNamesText(p.name, it.matchedNames)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              {op.packagesTotal !== null && <tfoot><tr><td>합계</td><td className="num">{fmtManwon(op.packagesTotal)}</td>{pp?.items && <td />}{pp?.items && <td />}</tr></tfoot>}
            </table>
          </>
        )}
    </section>
  );
}
