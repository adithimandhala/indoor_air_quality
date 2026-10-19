import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Home,
  Wind,
  TrendingUp,
  Anchor,
  PlusCircle,
  UserCircle,
  ChevronDown,
} from "lucide-react";
import { useAirMind } from "./AppContext.jsx";

const navigation = [
  { to: "/", label: "Overview", icon: Home, end: true },
  { to: "/air-quality", label: "Air Quality", icon: Wind },
  { to: "/predictions", label: "Predictions", icon: TrendingUp },
  { to: "/ventilation", label: "Ventilation", icon: Anchor },
  { to: "/explainability", label: "Explainability", icon: PlusCircle },
  { to: "/advisor", label: "AI Advisor", icon: UserCircle },
];

export default function AppLayout() {
  const { health, dataset, modelInfo, prediction } = useAirMind();
  const location = useLocation();

  const connected = health?.status === "ok" && health?.model_loaded;
  const rawUpdated = prediction?.updated_at || health?.checked_at;

  const formattedLastUpdated = rawUpdated
    ? new Date(rawUpdated)
        .toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        .replace(/, /g, " ")
    : "Oct 17, 2026 05:13 PM";

  // Clock for header date-time card
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = currentTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = currentTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const isOverview = location.pathname === "/";
  const pageNav = navigation.find((item) => item.to === location.pathname);
  const headerTitle = isOverview ? "Indoor Airspace" : pageNav?.label || "Indoor Airspace";
  const headerTagline = isOverview
    ? "Explore your environment, understand the air, and take informed action."
    : "Explore your environment, understand the air, and take informed action.";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="AirMind AI overview">
          <div className="brand-logo-wrap">
            <svg width="28" height="22" viewBox="0 0 28 22" fill="none" className="brand-waves">
              <path
                d="M2 4C5.5 0.5 8.5 7.5 12 4C15.5 0.5 18.5 7.5 22 4C25.5 0.5 26.5 2.5 27 3.5"
                stroke="#2ee6d6"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M2 11C5.5 7.5 8.5 14.5 12 11C15.5 7.5 18.5 14.5 22 11C25.5 7.5 26.5 9.5 27 10.5"
                stroke="#2ee6d6"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M2 18C5.5 14.5 8.5 21.5 12 18C15.5 14.5 18.5 21.5 22 18C25.5 14.5 26.5 16.5 27 17.5"
                stroke="#2ee6d6"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="brand-copy">
            <span className="brand-name">
              AirMind <span className="brand-accent">AI</span>
            </span>
            <span className="brand-tagline">THE ADAPTIVE AIRSPACE</span>
          </div>
        </NavLink>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Constellation mesh background behind status card */}
        <div className="sidebar-mesh-bg" aria-hidden="true">
          <svg width="260" height="150" viewBox="0 0 260 150" fill="none">
            <circle cx="20" cy="95" r="1.5" fill="#2ee6d6" opacity="0.3" />
            <circle cx="48" cy="84" r="1.5" fill="#2ee6d6" opacity="0.4" />
            <circle cx="78" cy="74" r="2" fill="#2ee6d6" opacity="0.6" />
            <circle cx="106" cy="80" r="1.5" fill="#2ee6d6" opacity="0.5" />
            <circle cx="135" cy="92" r="1.5" fill="#2ee6d6" opacity="0.35" />
            <circle cx="168" cy="106" r="2" fill="#2ee6d6" opacity="0.5" />
            <circle cx="202" cy="120" r="1.5" fill="#2ee6d6" opacity="0.4" />
            <circle cx="236" cy="132" r="1.5" fill="#2ee6d6" opacity="0.3" />
            <circle cx="45" cy="115" r="1.5" fill="#2ee6d6" opacity="0.35" />
            <circle cx="95" cy="102" r="2" fill="#2ee6d6" opacity="0.45" />
            <circle cx="145" cy="118" r="1.5" fill="#2ee6d6" opacity="0.3" />
          </svg>
        </div>

        <div className="sidebar-foot">
          <div className="system-card">
            <div className="system-status-row">
              <span className="dot dot-cyan" />
              <span className="system-status-text">System Status</span>
            </div>
            <div className="system-online-row">
              <span className={`dot ${connected ? "dot-online" : "dot-offline"}`} />
              <span className="system-online-text">{connected ? "Online" : "Offline"}</span>
            </div>
            <div className="system-info-row">
              <span className="info-text">
                Model: {modelInfo?.selected_model || "Random Forest"}
              </span>
            </div>
            <div className="system-info-row">
              <span className="info-text">
                Dataset: {dataset?.rows ? `${dataset.rows.toLocaleString()} records` : (connected ? "Loading..." : "Offline")}
              </span>
            </div>
            <div className="system-updated-block">
              <span className="updated-label">Last updated</span>
              <span className="updated-time font-mono">{formattedLastUpdated}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-titles">
            <h1 className="header-title">{headerTitle}</h1>
            {isOverview && (
              <p className="header-tagline">
                Explore your environment, understand the air, and take informed action.
              </p>
            )}
          </div>
          <div className="topbar-actions">
            {isOverview && (
              <div
                className="view-selector-pill"
                tabIndex={0}
                role="button"
                aria-label="Select view mode"
              >
                <span className="view-label">View</span>
                <div className="view-val-row">
                  <span className="view-val">3D Room</span>
                  <ChevronDown size={14} className="view-chevron" />
                </div>
              </div>
            )}
            <div className="datetime-card">
              <span className="datetime-date font-mono">{dateStr}</span>
              <span className="datetime-time font-mono">{timeStr}</span>
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}