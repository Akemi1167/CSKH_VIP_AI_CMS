import { App as AntApp, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { cmsTheme } from "./theme.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Thiếu #root");
}

createRoot(root).render(
  <ConfigProvider locale={viVN} theme={cmsTheme}>
    <AntApp>
      <App />
    </AntApp>
  </ConfigProvider>,
);
