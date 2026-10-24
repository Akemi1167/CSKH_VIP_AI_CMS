import { theme, type ThemeConfig } from "antd";

export const cmsTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#16a34a",
    colorInfo: "#16a34a",
    colorSuccess: "#34d399",
    colorWarning: "#fbbf24",
    colorError: "#ef4444",
    colorBgBase: "#0e1016",
    colorBgContainer: "#161922",
    colorBgElevated: "#1c2030",
    colorBorder: "#2a3040",
    colorText: "#eef0f6",
    colorTextSecondary: "#b8bfd0",
    borderRadius: 8,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Table: {
      headerBg: "#12151c",
      rowHoverBg: "#1c2030",
      borderColor: "#2a3040",
    },
    Card: {
      colorBgContainer: "#161922",
    },
    Input: {
      colorBgContainer: "#1a1e28",
    },
    Select: {
      colorBgContainer: "#1a1e28",
    },
    Modal: {
      contentBg: "#161922",
      headerBg: "#161922",
    },
  },
};
