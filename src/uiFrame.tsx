import { App as AntApp, ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import type { ReactNode } from "react";
import { cmsTheme } from "./theme.ts";

export function UiFrame(props: { children: ReactNode }) {
  return (
    <ConfigProvider locale={viVN} theme={cmsTheme}>
      <AntApp>{props.children}</AntApp>
    </ConfigProvider>
  );
}
