import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import AppPage from "./pages/AppPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
