import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes, Link } from 'react-router-dom'
import AppLayout from './AppLayout.jsx'
import { AppProvider } from './AppContext.jsx'
import {
  AdvisorPage,
  AirQualityPage,
  ExplainabilityPage,
  PredictionsPage,
  VentilationPage,
} from './pages.jsx'
import './index.css'

const Overview3DPage = lazy(() => import('./Overview3DPage.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Suspense fallback={<div className="page-loading">Loading the indoor environment...</div>}><Overview3DPage /></Suspense>} />
            <Route path="air-quality" element={<AirQualityPage />} />
            <Route path="predictions" element={<PredictionsPage />} />
            <Route path="ventilation" element={<VentilationPage />} />
            <Route path="explainability" element={<ExplainabilityPage />} />
            <Route path="advisor" element={<AdvisorPage />} />
            <Route path="*" element={<div className="not-found"><h2>Page not found</h2><Link to="/">Return to overview</Link></div>} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
