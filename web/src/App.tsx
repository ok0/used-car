import { useEffect, type ReactNode } from 'react';
import { Link, matchRoute, useLocation, type Route } from './router';
import { ThemeToggle } from './components/ThemeToggle';
import { Empty } from './components/States';
import { DashboardPage } from './pages/DashboardPage';
import { VehicleListPage } from './pages/VehicleListPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { ComparePage } from './pages/ComparePage';

const TITLE: Record<Route['name'], string> = { dashboard: '대시보드', vehicles: '매물 목록', vehicle: '매물 상세', compare: '가격 비교', notFound: '없는 화면' };

function NavTab({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return <Link to={to} className={`tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

export function App() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  useEffect(() => { document.title = `${TITLE[route.name]} — used-car`; }, [route.name]);
  let page: ReactNode;
  switch (route.name) {
    case 'dashboard': page = <DashboardPage />; break;
    case 'vehicles': page = <VehicleListPage />; break;
    case 'vehicle': page = <VehicleDetailPage key={route.carId} carId={route.carId} />; break;
    case 'compare': page = <ComparePage />; break;
    default: page = <Empty title="없는 화면입니다"><Link to="/">대시보드로</Link></Empty>;
  }
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">used-car</Link>
          <nav className="tabs" aria-label="주요 화면">
            <NavTab to="/" active={route.name === 'dashboard'}>대시보드</NavTab>
            <NavTab to="/vehicles" active={route.name === 'vehicles' || route.name === 'vehicle'}>매물 목록</NavTab>
            <NavTab to="/compare" active={route.name === 'compare'}>가격 비교</NavTab>
          </nav>
          <div className="header-right"><ThemeToggle /></div>
        </div>
      </header>
      <main className="app-main">{page}</main>
    </div>
  );
}
